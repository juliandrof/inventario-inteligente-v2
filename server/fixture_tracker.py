"""Fixture tracking and deduplication across video frames.

Uses position-based matching to track the same fixture across consecutive frames,
preventing double-counting as the camera moves through the store.

Improvements over naive approach:
1. Intra-frame dedup: merge detections of same type within close proximity in a single frame
2. Adaptive threshold: uses average position (centroid) for matching, not just last position
3. Post-processing merge: after all frames, merge tracks that likely represent the same fixture
4. Min-frame filter: fixtures seen in only 1 frame are likely noise (configurable)
"""

import math
import logging
from typing import Optional

logger = logging.getLogger(__name__)


class TrackedFixture:
    """Represents a unique fixture tracked across multiple frames."""

    def __init__(self, tracking_id: int, fixture_type: str, position: dict,
                 zone: str, confidence: float, occupancy: str, occupancy_pct: float,
                 description: str, frame_index: int, timestamp_sec: float):
        self.tracking_id = tracking_id
        self.fixture_type = fixture_type
        self.positions = [position]
        self.zone = zone
        self.confidences = [confidence]
        self.occupancies = [occupancy]
        self.occupancy_pcts = [occupancy_pct]
        self.descriptions = [description]
        self.frame_indices = [frame_index]
        self.first_seen_sec = timestamp_sec
        self.last_seen_sec = timestamp_sec
        self.best_confidence = confidence
        self.best_frame_index = frame_index
        self.frames_since_last_seen = 0

    @property
    def last_position(self) -> dict:
        return self.positions[-1]

    @property
    def centroid(self) -> dict:
        """Average position across all observations - more stable than last_position."""
        xs = [p.get("x", 50) for p in self.positions]
        ys = [p.get("y", 50) for p in self.positions]
        return {"x": sum(xs) / len(xs), "y": sum(ys) / len(ys)}

    @property
    def frame_count(self) -> int:
        return len(self.frame_indices)

    @property
    def avg_confidence(self) -> float:
        return sum(self.confidences) / len(self.confidences)

    @property
    def avg_occupancy_pct(self) -> float:
        return sum(self.occupancy_pcts) / len(self.occupancy_pcts)

    @property
    def dominant_occupancy(self) -> str:
        counts = {}
        for o in self.occupancies:
            counts[o] = counts.get(o, 0) + 1
        return max(counts, key=counts.get)

    @property
    def best_description(self) -> str:
        best_idx = self.confidences.index(max(self.confidences))
        return self.descriptions[best_idx]

    def update(self, position: dict, confidence: float, occupancy: str,
               occupancy_pct: float, description: str, frame_index: int, timestamp_sec: float):
        self.positions.append(position)
        self.confidences.append(confidence)
        self.occupancies.append(occupancy)
        self.occupancy_pcts.append(occupancy_pct)
        self.descriptions.append(description)
        self.frame_indices.append(frame_index)
        self.last_seen_sec = timestamp_sec
        self.frames_since_last_seen = 0
        if confidence > self.best_confidence:
            self.best_confidence = confidence
            self.best_frame_index = frame_index

    def absorb(self, other: 'TrackedFixture'):
        """Merge another track into this one (post-processing dedup)."""
        self.positions.extend(other.positions)
        self.confidences.extend(other.confidences)
        self.occupancies.extend(other.occupancies)
        self.occupancy_pcts.extend(other.occupancy_pcts)
        self.descriptions.extend(other.descriptions)
        self.frame_indices.extend(other.frame_indices)
        self.first_seen_sec = min(self.first_seen_sec, other.first_seen_sec)
        self.last_seen_sec = max(self.last_seen_sec, other.last_seen_sec)
        if other.best_confidence > self.best_confidence:
            self.best_confidence = other.best_confidence
            self.best_frame_index = other.best_frame_index


class FixtureTracker:
    """Tracks fixtures across frames using position-based matching."""

    def __init__(self, position_threshold: float = 15.0, max_frames_lost: int = 10):
        self.position_threshold = position_threshold
        self.max_frames_lost = max_frames_lost
        self.tracked_fixtures: list[TrackedFixture] = []
        self._next_id = 1

    def process_frame(self, detections: list[dict], frame_index: int, timestamp_sec: float) -> dict[int, int]:
        """Process detections from a single frame.

        Returns:
            mapping of detection_index -> tracking_id
        """
        # Step 1: Intra-frame dedup - merge same-type detections that are too close
        detections = self._dedup_within_frame(detections)

        # Step 2: Increment age for all active tracks
        for tf in self.tracked_fixtures:
            tf.frames_since_last_seen += 1

        matched_track_ids = set()
        matched_det_ids = set()
        det_to_track = {}

        # Step 3: Match using BOTH last position and centroid (take best match)
        candidates = []
        for di, det in enumerate(detections):
            for ti, tf in enumerate(self.tracked_fixtures):
                if tf.fixture_type != det["type"]:
                    continue
                if tf.frames_since_last_seen > self.max_frames_lost:
                    continue
                # Use minimum of: distance to last position, distance to centroid
                dist_last = self._position_distance(det["position"], tf.last_position)
                dist_centroid = self._position_distance(det["position"], tf.centroid)
                dist = min(dist_last, dist_centroid)
                if dist <= self.position_threshold:
                    candidates.append((dist, di, ti))

        # Greedy matching by shortest distance
        candidates.sort(key=lambda x: x[0])
        for dist, di, ti in candidates:
            if di in matched_det_ids or ti in matched_track_ids:
                continue
            det = detections[di]
            tf = self.tracked_fixtures[ti]
            tf.update(
                position=det["position"],
                confidence=det["confidence"],
                occupancy=det["occupancy"],
                occupancy_pct=det["occupancy_pct"],
                description=det["description"],
                frame_index=frame_index,
                timestamp_sec=timestamp_sec,
            )
            matched_track_ids.add(ti)
            matched_det_ids.add(di)
            det_to_track[di] = tf.tracking_id

        # Create new tracks for unmatched detections
        for di, det in enumerate(detections):
            if di in matched_det_ids:
                continue
            tf = TrackedFixture(
                tracking_id=self._next_id,
                fixture_type=det["type"],
                position=det["position"],
                zone=det["zone"],
                confidence=det["confidence"],
                occupancy=det["occupancy"],
                occupancy_pct=det["occupancy_pct"],
                description=det["description"],
                frame_index=frame_index,
                timestamp_sec=timestamp_sec,
            )
            self.tracked_fixtures.append(tf)
            det_to_track[di] = self._next_id
            self._next_id += 1

        return det_to_track

    def get_unique_fixtures(self, min_frames: int = 2) -> list[TrackedFixture]:
        """Get deduplicated fixture list.

        Args:
            min_frames: minimum number of frames a fixture must appear in.
                        Default 2 to filter single-frame noise.
        """
        # Post-processing: merge tracks of same type with overlapping centroids
        self._merge_similar_tracks()

        return [tf for tf in self.tracked_fixtures if tf.frame_count >= min_frames]

    def get_summary(self) -> dict[str, int]:
        fixtures = self.get_unique_fixtures()
        summary = {}
        for tf in fixtures:
            summary[tf.fixture_type] = summary.get(tf.fixture_type, 0) + 1
        return summary

    def _dedup_within_frame(self, detections: list[dict]) -> list[dict]:
        """Merge detections of the same type that are too close within a single frame."""
        if len(detections) <= 1:
            return detections

        merged = []
        used = set()
        intra_threshold = self.position_threshold * 0.8  # tighter threshold for same-frame

        for i, d1 in enumerate(detections):
            if i in used:
                continue
            best = d1
            for j, d2 in enumerate(detections):
                if j <= i or j in used:
                    continue
                if d1["type"] != d2["type"]:
                    continue
                dist = self._position_distance(d1["position"], d2["position"])
                if dist <= intra_threshold:
                    # Keep the one with higher confidence
                    if d2.get("confidence", 0) > best.get("confidence", 0):
                        best = d2
                    used.add(j)
            merged.append(best)
            used.add(i)

        if len(merged) < len(detections):
            logger.info(f"Intra-frame dedup: {len(detections)} -> {len(merged)}")

        return merged

    def _merge_similar_tracks(self):
        """Post-processing: merge tracks that have similar centroids and same type.

        This catches cases where the tracker lost a fixture and created a new track
        for what is actually the same physical fixture.
        """
        if len(self.tracked_fixtures) <= 1:
            return

        merge_threshold = self.position_threshold * 1.5  # more lenient for post-merge
        merged_into = {}  # track_index -> target_index
        fixtures = self.tracked_fixtures

        for i in range(len(fixtures)):
            if i in merged_into:
                continue
            for j in range(i + 1, len(fixtures)):
                if j in merged_into:
                    continue
                if fixtures[i].fixture_type != fixtures[j].fixture_type:
                    continue

                dist = self._position_distance(fixtures[i].centroid, fixtures[j].centroid)
                if dist <= merge_threshold:
                    # Check time overlap - don't merge if they appear in the same frames
                    frames_i = set(fixtures[i].frame_indices)
                    frames_j = set(fixtures[j].frame_indices)
                    overlap = frames_i & frames_j
                    if len(overlap) > 0:
                        # They appear simultaneously = genuinely different fixtures
                        continue

                    # Merge j into i
                    fixtures[i].absorb(fixtures[j])
                    merged_into[j] = i
                    logger.info(f"Post-merge: track {fixtures[j].tracking_id} -> {fixtures[i].tracking_id} "
                                f"({fixtures[i].fixture_type}, dist={dist:.1f})")

        if merged_into:
            self.tracked_fixtures = [f for idx, f in enumerate(fixtures) if idx not in merged_into]
            logger.info(f"Post-merge: {len(fixtures)} tracks -> {len(self.tracked_fixtures)}")

    @staticmethod
    def _position_distance(pos1: dict, pos2: dict) -> float:
        dx = pos1.get("x", 50) - pos2.get("x", 50)
        dy = pos1.get("y", 50) - pos2.get("y", 50)
        return math.sqrt(dx * dx + dy * dy)
