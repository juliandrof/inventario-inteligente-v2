-- Seed fixture types
INSERT INTO fixture_types (name, display_name, description, icon, color) VALUES
('ARARA', 'Arara', 'Arara de roupas - cabideiro circular ou reto para pendurar pecas', 'hanger', '#E11D48'),
('GONDOLA', 'Gondola', 'Gondola - estante expositora de multiplas prateleiras', 'shelf', '#2563EB'),
('CESTAO', 'Cestao', 'Cestao - cesto grande aberto para produtos a granel ou promocoes', 'basket', '#F59E0B'),
('PRATELEIRA', 'Prateleira', 'Prateleira de parede - modulo fixo na parede', 'wall-shelf', '#10B981'),
('BALCAO', 'Balcao', 'Balcao de atendimento ou vitrine', 'counter', '#8B5CF6'),
('DISPLAY', 'Display Promocional', 'Display de ponta de gondola ou ilha promocional', 'display', '#EC4899'),
('CHECKOUT', 'Checkout', 'Caixa registradora / checkout', 'register', '#6366F1'),
('MANEQUIM', 'Manequim', 'Manequim de vitrine ou exposicao', 'mannequin', '#14B8A6'),
('MESA', 'Mesa Expositora', 'Mesa para exposicao de produtos dobrados', 'table', '#F97316'),
('CABIDEIRO_PAREDE', 'Cabideiro de Parede', 'Cabideiro fixo na parede com ganchos', 'wall-hanger', '#84CC16')
ON CONFLICT (name) DO NOTHING;

-- Seed default configurations
INSERT INTO configurations (config_id, config_key, config_value, description, updated_at) VALUES
(1, 'scan_fps', '0.5', 'Frames por segundo para analise (0.5 = 1 frame a cada 2s)', NOW()),
(2, 'confidence_threshold', '0.6', 'Confianca minima para considerar uma deteccao valida', NOW()),
(3, 'dedup_position_threshold', '15', 'Distancia maxima (%) para considerar mesmo expositor entre frames', NOW()),
(4, 'anomaly_std_threshold', '1.5', 'Desvios padrao para alertar anomalia de contagem', NOW()),
(5, 'timezone', 'America/Sao_Paulo', 'Timezone para datas', NOW()),
(6, 'video_volume', '/Volumes/scenic_crawler/default/uploaded_videos', 'Volume para upload de videos', NOW()),
(7, 'thumbnail_volume', '/Volumes/scenic_crawler/default/thumbnails', 'Volume para thumbnails', NOW())
ON CONFLICT (config_key) DO NOTHING;

-- Seed branding (Lojas Americanas style)
INSERT INTO branding (setting_id, setting_key, setting_value, updated_at) VALUES
(1, 'primary_color', '#E11D48', NOW()),
(2, 'secondary_color', '#1E293B', NOW()),
(3, 'accent_color', '#F43F5E', NOW()),
(4, 'sidebar_color', '#0F172A', NOW()),
(5, 'app_name', 'Scenic Crawler AI', NOW()),
(6, 'app_subtitle', 'Inventario Inteligente de Expositores', NOW())
ON CONFLICT (setting_key) DO NOTHING;
