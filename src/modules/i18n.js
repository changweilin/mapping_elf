const LS_LANGUAGE_KEY = 'mappingElf_language';

export const LANGUAGES = [
  { code: 'zh-TW', label: '繁中' },
  { code: 'en', label: 'EN' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'fr', label: 'FR' },
  { code: 'de', label: 'DE' },
  { code: 'es', label: 'ES' },
  { code: 'it', label: 'IT' },
];

const SUPPORTED = new Set(LANGUAGES.map(l => l.code));

const STRINGS = {
  'app.description': {
    'zh-TW': '互動式地圖應用，支援離線/線上地圖、自動GPX軌跡生成、高度剖面圖、距離統計與天氣預報。',
    en: 'Interactive mapping app for offline/online maps, GPX route generation, elevation profiles, distance stats, and weather forecasts.',
    ja: 'オフライン/オンライン地図、GPXルート作成、標高プロファイル、距離統計、天気予報に対応したインタラクティブ地図アプリ。',
    ko: '오프라인/온라인 지도, GPX 루트 생성, 고도 프로필, 거리 통계, 날씨 예보를 지원하는 인터랙티브 지도 앱입니다.',
    fr: 'Application cartographique interactive avec cartes hors ligne/en ligne, génération GPX, profil d’altitude, statistiques de distance et météo.',
    de: 'Interaktive Karten-App mit Offline-/Onlinekarten, GPX-Routenerstellung, Höhenprofil, Distanzstatistik und Wetterprognosen.',
    es: 'Aplicación cartográfica interactiva con mapas sin conexión/en línea, rutas GPX, perfil de altitud, estadísticas de distancia y previsión meteorológica.',
    it: 'App cartografica interattiva con mappe offline/online, generazione GPX, profilo altimetrico, statistiche di distanza e previsioni meteo.',
  },
  'quote.translation': {
    'zh-TW': '我愛星空至深，無懼黑夜。',
    en: '',
    ja: '星々を深く愛してきたからこそ、闇を恐れない。',
    ko: '별들을 깊이 사랑해 왔기에 어둠을 두려워하지 않는다.',
    fr: 'Nous avons trop aimé les étoiles pour craindre la nuit.',
    de: 'Wir haben die Sterne zu innig geliebt, um die Dunkelheit zu fürchten.',
    es: 'Hemos amado tanto las estrellas que no tememos la oscuridad.',
    it: 'Abbiamo amato le stelle così profondamente da non temere il buio.',
  },
};

const PHRASES = {
  'Mapping Elf — GPX 軌跡生成器': {
    en: 'Mapping Elf — GPX Route Builder',
    ja: 'Mapping Elf — GPXルート作成ツール',
    ko: 'Mapping Elf — GPX 루트 생성기',
    fr: 'Mapping Elf — Créateur de routes GPX',
    de: 'Mapping Elf — GPX-Routenplaner',
    es: 'Mapping Elf — Creador de rutas GPX',
    it: 'Mapping Elf — Generatore di percorsi GPX',
  },
  '載入地圖中...': { en: 'Loading map...', ja: '地図を読み込み中...', ko: '지도를 불러오는 중...', fr: 'Chargement de la carte...', de: 'Karte wird geladen...', es: 'Cargando mapa...', it: 'Caricamento mappa...' },
  '街道': { en: 'Streets', ja: '道路', ko: '도로', fr: 'Rues', de: 'Straßen', es: 'Calles', it: 'Strade' },
  '地形': { en: 'Topo', ja: '地形', ko: '지형', fr: 'Topo', de: 'Topo', es: 'Topo', it: 'Topo' },
  '衛星': { en: 'Satellite', ja: '衛星', ko: '위성', fr: 'Satellite', de: 'Satellit', es: 'Satélite', it: 'Satellite' },
  '街道圖': { en: 'Street map', ja: '道路地図', ko: '도로 지도', fr: 'Carte routière', de: 'Straßenkarte', es: 'Mapa de calles', it: 'Mappa stradale' },
  '地形圖': { en: 'Topographic map', ja: '地形図', ko: '지형도', fr: 'Carte topo', de: 'Topografische Karte', es: 'Mapa topográfico', it: 'Mappa topografica' },
  '衛星圖': { en: 'Satellite map', ja: '衛星地図', ko: '위성 지도', fr: 'Carte satellite', de: 'Satellitenkarte', es: 'Mapa satelital', it: 'Mappa satellitare' },
  '全部回到預設': { en: 'Reset all defaults', ja: 'すべて既定値に戻す', ko: '모두 기본값으로 재설정', fr: 'Réinitialiser tous les réglages', de: 'Alles zurücksetzen', es: 'Restablecer todo', it: 'Ripristina tutto' },
  '匯入路線（GPX / KML）': { en: 'Import route (GPX / KML)', ja: 'ルートをインポート（GPX / KML）', ko: '루트 가져오기 (GPX / KML)', fr: 'Importer un itinéraire (GPX / KML)', de: 'Route importieren (GPX / KML)', es: 'Importar ruta (GPX / KML)', it: 'Importa percorso (GPX / KML)' },
  '匯出路線': { en: 'Export route', ja: 'ルートを書き出す', ko: '루트 내보내기', fr: 'Exporter l’itinéraire', de: 'Route exportieren', es: 'Exportar ruta', it: 'Esporta percorso' },
  '檔案管理': { en: 'File management', ja: 'ファイル管理', ko: '파일 관리', fr: 'Gestion des fichiers', de: 'Dateiverwaltung', es: 'Gestión de archivos', it: 'Gestione file' },
  '匯入': { en: 'Import', ja: 'インポート', ko: '가져오기', fr: 'Importer', de: 'Importieren', es: 'Importar', it: 'Importa' },
  '重置': { en: 'Reset', ja: 'リセット', ko: '재설정', fr: 'Réinitialiser', de: 'Zurücksetzen', es: 'Restablecer', it: 'Ripristina' },
  '切換深淺色': { en: 'Toggle theme', ja: 'テーマ切替', ko: '테마 전환', fr: 'Changer de thème', de: 'Design wechseln', es: 'Cambiar tema', it: 'Cambia tema' },
  '設置面板': { en: 'Settings panel', ja: '設定パネル', ko: '설정 패널', fr: 'Panneau de réglages', de: 'Einstellungsbereich', es: 'Panel de ajustes', it: 'Pannello impostazioni' },
  '回到軌跡': { en: 'Fit to route', ja: 'ルート全体へ', ko: '루트에 맞추기', fr: 'Recentrer sur l’itinéraire', de: 'Route einpassen', es: 'Ajustar a la ruta', it: 'Adatta al percorso' },
  '回到當前位置': { en: 'Go to current location', ja: '現在地へ', ko: '현재 위치로', fr: 'Aller à la position actuelle', de: 'Zum aktuellen Standort', es: 'Ir a ubicación actual', it: 'Vai alla posizione attuale' },
  '新增路線後顯示高度剖面': { en: 'Add a route to show the elevation profile', ja: 'ルートを追加すると標高プロファイルを表示します', ko: '루트를 추가하면 고도 프로필이 표시됩니다', fr: 'Ajoutez un itinéraire pour afficher le profil d’altitude', de: 'Route hinzufügen, um das Höhenprofil zu sehen', es: 'Añade una ruta para ver el perfil de altitud', it: 'Aggiungi un percorso per vedere il profilo altimetrico' },
  '完成規劃路線後點擊「取得天氣」': { en: 'After planning a route, tap “Get weather”', ja: 'ルート作成後に「天気を取得」を押してください', ko: '루트 계획 후 “날씨 가져오기”를 누르세요', fr: 'Après avoir planifié l’itinéraire, touchez « Obtenir la météo »', de: 'Nach der Routenplanung „Wetter abrufen“ wählen', es: 'Tras planificar la ruta, toca “Obtener tiempo”', it: 'Dopo aver pianificato il percorso, tocca “Ottieni meteo”' },
  '完成規劃路線後點擊「更新天氣」': { en: 'After planning a route, tap “Update weather”', ja: 'ルート作成後に「天気を更新」を押してください', ko: '루트 계획 후 “날씨 업데이트”를 누르세요', fr: 'Après avoir planifié l’itinéraire, touchez « Mettre à jour la météo »', de: 'Nach der Routenplanung „Wetter aktualisieren“ wählen', es: 'Tras planificar la ruta, toca “Actualizar tiempo”', it: 'Dopo aver pianificato il percorso, tocca “Aggiorna meteo”' },
  '關鍵字搜索': { en: 'Keyword search', ja: 'キーワード検索', ko: '키워드 검색', fr: 'Recherche par mot-clé', de: 'Stichwortsuche', es: 'Búsqueda por palabra clave', it: 'Ricerca per parola chiave' },
  '輸入地名、座標...': { en: 'Enter place name or coordinates...', ja: '地名または座標を入力...', ko: '장소명 또는 좌표 입력...', fr: 'Saisir un lieu ou des coordonnées...', de: 'Ort oder Koordinaten eingeben...', es: 'Introduce lugar o coordenadas...', it: 'Inserisci luogo o coordinate...' },
  '搜尋': { en: 'Search', ja: '検索', ko: '검색', fr: 'Rechercher', de: 'Suchen', es: 'Buscar', it: 'Cerca' },
  '在 Google Maps 搜尋關鍵字': { en: 'Search keyword in Google Maps', ja: 'Google Mapsで検索', ko: 'Google Maps에서 검색', fr: 'Rechercher dans Google Maps', de: 'In Google Maps suchen', es: 'Buscar en Google Maps', it: 'Cerca in Google Maps' },
  '緯度, 經度 (e.g. 25.034, 121.564)': { en: 'Latitude, longitude (e.g. 25.034, 121.564)', ja: '緯度, 経度 (e.g. 25.034, 121.564)', ko: '위도, 경도 (e.g. 25.034, 121.564)', fr: 'Latitude, longitude (e.g. 25.034, 121.564)', de: 'Breite, Länge (e.g. 25.034, 121.564)', es: 'Latitud, longitud (e.g. 25.034, 121.564)', it: 'Latitudine, longitudine (e.g. 25.034, 121.564)' },
  '定位至座標': { en: 'Go to coordinates', ja: '座標へ移動', ko: '좌표로 이동', fr: 'Aller aux coordonnées', de: 'Zu Koordinaten springen', es: 'Ir a coordenadas', it: 'Vai alle coordinate' },
  '復原 (Ctrl+Z)': { en: 'Undo (Ctrl+Z)', ja: '元に戻す (Ctrl+Z)', ko: '실행 취소 (Ctrl+Z)', fr: 'Annuler (Ctrl+Z)', de: 'Rückgängig (Ctrl+Z)', es: 'Deshacer (Ctrl+Z)', it: 'Annulla (Ctrl+Z)' },
  '取消復原 (Ctrl+Shift+Z)': { en: 'Redo (Ctrl+Shift+Z)', ja: 'やり直す (Ctrl+Shift+Z)', ko: '다시 실행 (Ctrl+Shift+Z)', fr: 'Rétablir (Ctrl+Shift+Z)', de: 'Wiederholen (Ctrl+Shift+Z)', es: 'Rehacer (Ctrl+Shift+Z)', it: 'Ripeti (Ctrl+Shift+Z)' },
  '復原': { en: 'undo', ja: '元に戻す', ko: '실행 취소', fr: 'annuler', de: 'rückgängig', es: 'deshacer', it: 'annulla' },
  '重新規劃路線': { en: 'Replan route', ja: 'ルートを再計算', ko: '루트 다시 계획', fr: 'Replanifier l’itinéraire', de: 'Route neu planen', es: 'Replanificar ruta', it: 'Ricalcola percorso' },
  '加入我的最愛': { en: 'Add to favorites', ja: 'お気に入りに追加', ko: '즐겨찾기에 추가', fr: 'Ajouter aux favoris', de: 'Zu Favoriten hinzufügen', es: 'Añadir a favoritos', it: 'Aggiungi ai preferiti' },
  '打開我的最愛清單': { en: 'Open favorites', ja: 'お気に入りを開く', ko: '즐겨찾기 열기', fr: 'Ouvrir les favoris', de: 'Favoriten öffnen', es: 'Abrir favoritos', it: 'Apri preferiti' },
  '清除路線': { en: 'Clear route', ja: 'ルートを消去', ko: '루트 지우기', fr: 'Effacer l’itinéraire', de: 'Route löschen', es: 'Borrar ruta', it: 'Cancella percorso' },
  '路線規劃': { en: 'Route planning', ja: 'ルート計画', ko: '루트 계획', fr: 'Planification d’itinéraire', de: 'Routenplanung', es: 'Planificación de ruta', it: 'Pianificazione percorso' },
  '路線規劃中': { en: 'Planning route', ja: 'ルート計画中', ko: '경로 계획 중', fr: 'Planification de l’itinéraire', de: 'Route wird geplant', es: 'Planificando ruta', it: 'Pianificazione percorso' },
  '在地圖上點擊以新增航點': { en: 'Click the map to add waypoints', ja: '地図をクリックしてウェイポイントを追加', ko: '지도에서 클릭해 웨이포인트 추가', fr: 'Cliquez sur la carte pour ajouter des waypoints', de: 'Klicken Sie auf die Karte, um Wegpunkte hinzuzufügen', es: 'Haz clic en el mapa para añadir waypoints', it: 'Fai clic sulla mappa per aggiungere waypoint' },
  '點擊地圖任意位置開始規劃路線': { en: 'Click anywhere on the map to start planning', ja: '地図上をクリックして計画を開始', ko: '지도 아무 곳이나 클릭해 계획 시작', fr: 'Cliquez sur la carte pour commencer', de: 'Klicken Sie auf die Karte, um zu planen', es: 'Haz clic en el mapa para empezar', it: 'Fai clic sulla mappa per iniziare' },
  '單程': { en: 'One-way', ja: '片道', ko: '편도', fr: 'Aller simple', de: 'Einfach', es: 'Solo ida', it: 'Solo andata' },
  '來回': { en: 'Out & back', ja: '往復', ko: '왕복', fr: 'Aller-retour', de: 'Hin und zurück', es: 'Ida y vuelta', it: 'Andata e ritorno' },
  'O繞': { en: 'Loop', ja: '周回', ko: '순환', fr: 'Boucle', de: 'Rundtour', es: 'Circular', it: 'Anello' },
  '步行': { en: 'Walking', ja: '徒歩', ko: '걷기', fr: 'Marche', de: 'Gehen', es: 'Caminar', it: 'Camminata' },
  '山徑': { en: 'Trail', ja: '登山道', ko: '산길', fr: 'Sentier', de: 'Wanderweg', es: 'Sendero', it: 'Sentiero' },
  '健行': { en: 'Hiking', ja: 'ハイキング', ko: '하이킹', fr: 'Randonnée', de: 'Wandern', es: 'Senderismo', it: 'Escursionismo' },
  '越野跑': { en: 'Trail run', ja: 'トレイルラン', ko: '트레일 러닝', fr: 'Trail', de: 'Trailrunning', es: 'Trail running', it: 'Trail running' },
  '跑步': { en: 'Running', ja: 'ランニング', ko: '러닝', fr: 'Course', de: 'Laufen', es: 'Correr', it: 'Corsa' },
  '自行車': { en: 'Cycling', ja: '自転車', ko: '자전거', fr: 'Vélo', de: 'Radfahren', es: 'Ciclismo', it: 'Bici' },
  '駕車': { en: 'Driving', ja: '車', ko: '운전', fr: 'Voiture', de: 'Auto', es: 'Conducir', it: 'Auto' },
  '配速參數': { en: 'Pace parameters', ja: 'ペース設定', ko: '페이스 설정', fr: 'Paramètres d’allure', de: 'Tempo-Parameter', es: 'Parámetros de ritmo', it: 'Parametri di passo' },
  '重置配速': { en: 'Reset pace', ja: 'ペースをリセット', ko: '페이스 재설정', fr: 'Réinitialiser l’allure', de: 'Tempo zurücksetzen', es: 'Restablecer ritmo', it: 'Reimposta passo' },
  '平地配速': { en: 'Flat pace', ja: '平地ペース', ko: '평지 페이스', fr: 'Allure sur plat', de: 'Tempo in der Ebene', es: 'Ritmo en llano', it: 'Passo in piano' },
  '上河': { en: 'Shanghe', ja: 'Shanghe', ko: 'Shanghe', fr: 'Shanghe', de: 'Shanghe', es: 'Shanghe', it: 'Shanghe' },
  '疲勞程度': { en: 'Fatigue level', ja: '疲労度', ko: '피로도', fr: 'Niveau de fatigue', de: 'Ermüdung', es: 'Nivel de fatiga', it: 'Livello di fatica' },
  '無疲勞': { en: 'No fatigue', ja: '疲労なし', ko: '피로 없음', fr: 'Aucune fatigue', de: 'Keine Ermüdung', es: 'Sin fatiga', it: 'Nessuna fatica' },
  '非耐力': { en: 'Casual', ja: '軽め', ko: '가벼움', fr: 'Occasionnel', de: 'Locker', es: 'Ocasional', it: 'Occasionale' },
  '一般': { en: 'General', ja: '標準', ko: '일반', fr: 'Général', de: 'Normal', es: 'General', it: 'Generale' },
  '專項': { en: 'Trained', ja: '鍛錬あり', ko: '훈련됨', fr: 'Entraîné', de: 'Trainiert', es: 'Entrenado', it: 'Allenato' },
  '按段重算': { en: 'Recalculate by segment', ja: '区間ごとに再計算', ko: '구간별 재계산', fr: 'Recalculer par segment', de: 'Nach Abschnitt neu berechnen', es: 'Recalcular por tramo', it: 'Ricalcola per segmento' },
  '配速時間': { en: 'Pace times', ja: 'ペース時刻', ko: '페이스 시간', fr: 'Horaires d’allure', de: 'Tempozeiten', es: 'Tiempos de ritmo', it: 'Tempi di passo' },
  '體重': { en: 'Body weight', ja: '体重', ko: '체중', fr: 'Poids', de: 'Körpergewicht', es: 'Peso corporal', it: 'Peso corporeo' },
  '負重': { en: 'Pack weight', ja: '荷重', ko: '배낭 무게', fr: 'Poids du sac', de: 'Rucksackgewicht', es: 'Peso de mochila', it: 'Peso zaino' },
  '休息間隔': { en: 'Rest interval', ja: '休憩間隔', ko: '휴식 간격', fr: 'Intervalle de pause', de: 'Pausenintervall', es: 'Intervalo de descanso', it: 'Intervallo pause' },
  '休息時長': { en: 'Rest duration', ja: '休憩時間', ko: '휴식 시간', fr: 'Durée de pause', de: 'Pausendauer', es: 'Duración del descanso', it: 'Durata pausa' },
  '小時': { en: 'hours', ja: '時間', ko: '시간', fr: 'h', de: 'Std.', es: 'h', it: 'h' },
  '分': { en: 'min', ja: '分', ko: '분', fr: 'min', de: 'Min.', es: 'min', it: 'min' },
  '天': { en: 'd', ja: '日', ko: '일', fr: 'j', de: 'Tg.', es: 'd', it: 'g' },
  '公式摘要': { en: 'Formula summary', ja: '計算式の概要', ko: '공식 요약', fr: 'Résumé de la formule', de: 'Formelübersicht', es: 'Resumen de fórmula', it: 'Riepilogo formula' },
  '個人配速校正': { en: 'Personal pace calibration', ja: '個人ペース補正', ko: '개인 페이스 보정', fr: 'Calibration personnelle', de: 'Persönliche Tempo-Kalibrierung', es: 'Calibración personal', it: 'Calibrazione personale' },
  '啟用個人校正': { en: 'Enable personal calibration', ja: '個人補正を有効化', ko: '개인 보정 사용', fr: 'Activer la calibration', de: 'Kalibrierung aktivieren', es: 'Activar calibración', it: 'Attiva calibrazione' },
  '載入軌跡': { en: 'Load tracks', ja: '軌跡を読み込む', ko: '트랙 불러오기', fr: 'Charger des traces', de: 'Tracks laden', es: 'Cargar tracks', it: 'Carica tracce' },
  '計算校正': { en: 'Calculate calibration', ja: '補正を計算', ko: '보정 계산', fr: 'Calculer', de: 'Kalibrierung berechnen', es: 'Calcular', it: 'Calcola' },
  '清除': { en: 'Clear', ja: 'クリア', ko: '지우기', fr: 'Effacer', de: 'Löschen', es: 'Borrar', it: 'Cancella' },
  '預估': { en: 'Estimated', ja: '予想', ko: '예상', fr: 'Estimé', de: 'Geschätzt', es: 'Estimado', it: 'Stimato' },
  '實際': { en: 'Actual', ja: '実績', ko: '실제', fr: 'Réel', de: 'Tatsächlich', es: 'Real', it: 'Effettivo' },
  '移除': { en: 'Remove', ja: '削除', ko: '제거', fr: 'Retirer', de: 'Entfernen', es: 'Quitar', it: 'Rimuovi' },
  '尚未載入校正軌跡': { en: 'No calibration tracks loaded', ja: '補正軌跡は未読み込みです', ko: '불러온 보정 트랙이 없습니다', fr: 'Aucune trace de calibration chargée', de: 'Keine Kalibrier-Tracks geladen', es: 'No hay tracks de calibración cargados', it: 'Nessuna traccia di calibrazione caricata' },
  '航點設置': { en: 'Waypoint settings', ja: 'ウェイポイント設定', ko: '웨이포인트 설정', fr: 'Réglages des waypoints', de: 'Wegpunkt-Einstellungen', es: 'Ajustes de waypoints', it: 'Impostazioni waypoint' },
  '關': { en: 'Off', ja: 'オフ', ko: '끔', fr: 'Non', de: 'Aus', es: 'No', it: 'Off' },
  '距離': { en: 'Distance', ja: '距離', ko: '거리', fr: 'Distance', de: 'Distanz', es: 'Distancia', it: 'Distanza' },
  '配速': { en: 'Pace', ja: 'ペース', ko: '페이스', fr: 'Allure', de: 'Tempo', es: 'Ritmo', it: 'Passo' },
  '集體操作': { en: 'Bulk actions', ja: '一括操作', ko: '일괄 작업', fr: 'Actions groupées', de: 'Sammelaktionen', es: 'Acciones en lote', it: 'Azioni di gruppo' },
  '全標示點': { en: 'All marked points', ja: '全マーク点', ko: '모든 표시 지점', fr: 'Tous les points marqués', de: 'Alle markierten Punkte', es: 'Todos los puntos marcados', it: 'Tutti i punti marcati' },
  '全中繼點': { en: 'All intermediate points', ja: '全中間点', ko: '모든 중간 지점', fr: 'Tous les points intermédiaires', de: 'Alle Zwischenpunkte', es: 'Todos los puntos intermedios', it: 'Tutti i punti intermedi' },
  '全航點': { en: 'All waypoints', ja: '全ウェイポイント', ko: '모든 웨이포인트', fr: 'Tous les waypoints', de: 'Alle Wegpunkte', es: 'Todos los waypoints', it: 'Tutti i waypoint' },
  '縮到最小': { en: 'Minimize', ja: '最小化', ko: '최소화', fr: 'Réduire', de: 'Minimieren', es: 'Minimizar', it: 'Riduci' },
  '切換大/小格': { en: 'Toggle detail', ja: '詳細/簡易切替', ko: '상세/간단 전환', fr: 'Détail/compact', de: 'Detail/kompakt', es: 'Detalle/compacto', it: 'Dettaglio/compatto' },
  '顯示設置': { en: 'Display settings', ja: '表示設定', ko: '표시 설정', fr: 'Affichage', de: 'Anzeige', es: 'Visualización', it: 'Visualizzazione' },
  '顯示天氣圖示': { en: 'Show weather icons', ja: '天気アイコンを表示', ko: '날씨 아이콘 표시', fr: 'Afficher les icônes météo', de: 'Wettersymbole anzeigen', es: 'Mostrar iconos del tiempo', it: 'Mostra icone meteo' },
  '主航點': { en: 'Main waypoints', ja: '主要ウェイポイント', ko: '주요 웨이포인트', fr: 'Waypoints principaux', de: 'Hauptwegpunkte', es: 'Waypoints principales', it: 'Waypoint principali' },
  '中繼點': { en: 'Intermediate point', ja: '中間点', ko: '중간 지점', fr: 'Point intermédiaire', de: 'Zwischenpunkt', es: 'Punto intermedio', it: 'Punto intermedio' },
  '航點置中': { en: 'Center waypoint', ja: 'ウェイポイントを中央へ', ko: '웨이포인트 중앙 정렬', fr: 'Centrer le waypoint', de: 'Wegpunkt zentrieren', es: 'Centrar waypoint', it: 'Centra waypoint' },
  '匯入設置': { en: 'Import settings', ja: 'インポート設定', ko: '가져오기 설정', fr: 'Réglages d’import', de: 'Import-Einstellungen', es: 'Ajustes de importación', it: 'Impostazioni importazione' },
  '匯入自動排序': { en: 'Auto-sort imports', ja: 'インポートを自動並べ替え', ko: '가져오기 자동 정렬', fr: 'Tri automatique à l’import', de: 'Importe automatisch sortieren', es: 'Ordenar importación automáticamente', it: 'Ordina import automaticamente' },
  '匯入自動命名': { en: 'Auto-name imports', ja: 'インポートを自動命名', ko: '가져오기 자동 이름 지정', fr: 'Nommer automatiquement à l’import', de: 'Importe automatisch benennen', es: 'Nombrar importación automáticamente', it: 'Nomina import automaticamente' },
  '路線統計': { en: 'Route stats', ja: 'ルート統計', ko: '루트 통계', fr: 'Statistiques', de: 'Routenstatistik', es: 'Estadísticas', it: 'Statistiche percorso' },
  '總距離': { en: 'Total distance', ja: '総距離', ko: '총거리', fr: 'Distance totale', de: 'Gesamtdistanz', es: 'Distancia total', it: 'Distanza totale' },
  '預估時間': { en: 'Estimated time', ja: '予想時間', ko: '예상 시간', fr: 'Temps estimé', de: 'Geschätzte Zeit', es: 'Tiempo estimado', it: 'Tempo stimato' },
  '起點海拔': { en: 'Start elevation', ja: '開始標高', ko: '출발 고도', fr: 'Altitude départ', de: 'Starthöhe', es: 'Altitud inicial', it: 'Quota partenza' },
  '終點海拔': { en: 'End elevation', ja: '終了標高', ko: '도착 고도', fr: 'Altitude arrivée', de: 'Zielhöhe', es: 'Altitud final', it: 'Quota arrivo' },
  '最高海拔': { en: 'Highest elevation', ja: '最高標高', ko: '최고 고도', fr: 'Altitude max', de: 'Max. Höhe', es: 'Altitud máxima', it: 'Quota massima' },
  '最低海拔': { en: 'Lowest elevation', ja: '最低標高', ko: '최저 고도', fr: 'Altitude min', de: 'Min. Höhe', es: 'Altitud mínima', it: 'Quota minima' },
  '總爬升': { en: 'Total ascent', ja: '累積上昇', ko: '총 상승고도', fr: 'Dénivelé positif', de: 'Gesamtaufstieg', es: 'Ascenso total', it: 'Dislivello positivo' },
  '總下降': { en: 'Total descent', ja: '累積下降', ko: '총 하강고도', fr: 'Dénivelé négatif', de: 'Gesamtabstieg', es: 'Descenso total', it: 'Dislivello negativo' },
  '消耗熱量': { en: 'Calories burned', ja: '消費カロリー', ko: '소모 칼로리', fr: 'Calories dépensées', de: 'Kalorienverbrauch', es: 'Calorías quemadas', it: 'Calorie consumate' },
  '建議補給': { en: 'Suggested fueling', ja: '補給目安', ko: '보급 권장량', fr: 'Ravitaillement conseillé', de: 'Empfohlene Verpflegung', es: 'Avituallamiento sugerido', it: 'Rifornimento consigliato' },
  '天氣設置': { en: 'Weather settings', ja: '天気設定', ko: '날씨 설정', fr: 'Réglages météo', de: 'Wetter-Einstellungen', es: 'Ajustes meteorológicos', it: 'Impostazioni meteo' },
  '天氣快取': { en: 'Weather cache', ja: '天気キャッシュ', ko: '날씨 캐시', fr: 'Cache météo', de: 'Wetter-Cache', es: 'Caché meteorológica', it: 'Cache meteo' },
  '啟用天氣快取': { en: 'Enable weather cache', ja: '天気キャッシュを有効化', ko: '날씨 캐시 사용', fr: 'Activer le cache météo', de: 'Wetter-Cache aktivieren', es: 'Activar caché meteorológica', it: 'Attiva cache meteo' },
  '優先套用附近已更新的天氣資料，減少重複 API 請求': { en: 'Prefer recently updated nearby weather data to reduce duplicate API requests', ja: '近くの更新済み天気データを優先し、重複APIリクエストを減らします', ko: '가까운 최신 날씨 데이터를 우선 사용하여 중복 API 요청을 줄입니다', fr: 'Utilise d’abord les données météo voisines récentes afin de réduire les appels API en double', de: 'Bevorzugt nahe, kürzlich aktualisierte Wetterdaten und reduziert doppelte API-Anfragen', es: 'Prioriza datos meteorológicos cercanos y recientes para reducir solicitudes API duplicadas', it: 'Preferisce dati meteo vicini aggiornati per ridurre richieste API duplicate' },
  '新航點可套用此距離內的既有天氣資料': { en: 'New waypoints can reuse existing weather data within this distance', ja: '新しいウェイポイントはこの距離内の既存天気データを再利用できます', ko: '새 웨이포인트는 이 거리 안의 기존 날씨 데이터를 재사용할 수 있습니다', fr: 'Les nouveaux waypoints peuvent réutiliser les données météo existantes dans cette distance', de: 'Neue Wegpunkte können vorhandene Wetterdaten innerhalb dieser Entfernung verwenden', es: 'Los nuevos waypoints pueden reutilizar datos meteorológicos dentro de esta distancia', it: 'I nuovi waypoint possono riusare dati meteo entro questa distanza' },
  '新航點可套用此高度差內的既有天氣資料': { en: 'New waypoints can reuse existing weather data within this elevation difference', ja: '新しいウェイポイントはこの標高差内の既存天気データを再利用できます', ko: '새 웨이포인트는 이 고도 차이 안의 기존 날씨 데이터를 재사용할 수 있습니다', fr: 'Les nouveaux waypoints peuvent réutiliser les données dans cet écart d’altitude', de: 'Neue Wegpunkte können vorhandene Daten innerhalb dieses Höhenunterschieds verwenden', es: 'Los nuevos waypoints pueden reutilizar datos dentro de esta diferencia de altitud', it: 'I nuovi waypoint possono riusare dati entro questo dislivello' },
  '資料最後更新超過設定天數會自動清除': { en: 'Data is cleared when its last update is older than the configured number of days', ja: '最終更新が設定日数を超えたデータは自動削除されます', ko: '마지막 업데이트가 설정 일수보다 오래된 데이터는 자동 삭제됩니다', fr: 'Les données sont supprimées quand leur dernière mise à jour dépasse le nombre de jours défini', de: 'Daten werden gelöscht, wenn die letzte Aktualisierung älter als die eingestellte Tageszahl ist', es: 'Los datos se borran cuando su última actualización supera los días configurados', it: 'I dati vengono eliminati quando l’ultimo aggiornamento supera i giorni impostati' },
  '距離相近': { en: 'Nearby distance', ja: '近接距離', ko: '가까운 거리', fr: 'Distance proche', de: 'Nahe Entfernung', es: 'Distancia cercana', it: 'Distanza vicina' },
  '高度相近': { en: 'Elevation delta', ja: '標高差', ko: '고도 차이', fr: 'Écart d’altitude', de: 'Höhenunterschied', es: 'Diferencia de altitud', it: 'Dislivello' },
  '最後更新超過': { en: 'Last update older than', ja: '最終更新が超過', ko: '마지막 업데이트 초과', fr: 'Dernière mise à jour >', de: 'Letzte Aktualisierung älter als', es: 'Última actualización mayor que', it: 'Ultimo aggiornamento oltre' },
  '點擊「更新天氣」會清除臨時庫；清理條件依資料最後更新時間判斷。': { en: 'Tap “Update weather” to clear the temporary database; cleanup uses the data update time.', ja: '「天気を更新」を押すと一時データベースを消去します。削除判定はデータの更新時刻を使います。', ko: '“날씨 업데이트”를 누르면 임시 데이터베이스가 비워지며, 정리는 데이터 업데이트 시간을 기준으로 합니다.', fr: 'Touchez « Mettre à jour la météo » pour vider la base temporaire ; le nettoyage utilise l’heure de mise à jour des données.', de: '„Wetter aktualisieren“ leert die temporäre Datenbank; bereinigt wird nach Aktualisierungszeit der Daten.', es: '“Actualizar tiempo” borra la base temporal; la limpieza usa la hora de actualización de los datos.', it: '“Aggiorna meteo” svuota il database temporaneo; la pulizia usa l’ora di aggiornamento dei dati.' },
  '雷達': { en: 'Radar', ja: 'レーダー', ko: '레이더', fr: 'Radar', de: 'Radar', es: 'Radar', it: 'Radar' },
  '雷暴': { en: 'Thunderstorms', ja: '雷雨', ko: '뇌우', fr: 'Orages', de: 'Gewitter', es: 'Tormentas', it: 'Temporali' },
  '累積雨量': { en: 'Rain accumulation', ja: '積算雨量', ko: '누적 강수량', fr: 'Cumul de pluie', de: 'Regenmenge', es: 'Lluvia acumulada', it: 'Accumulo pioggia' },
  '波浪': { en: 'Waves', ja: '波', ko: '파도', fr: 'Vagues', de: 'Wellen', es: 'Olas', it: 'Onde' },
  '空氣品質': { en: 'Air quality', ja: '空気質', ko: '대기질', fr: 'Qualité de l’air', de: 'Luftqualität', es: 'Calidad del aire', it: 'Qualità dell’aria' },
  '比較預報': { en: 'Compare models', ja: '予報比較', ko: '예보 비교', fr: 'Comparer les modèles', de: 'Modelle vergleichen', es: 'Comparar modelos', it: 'Confronta modelli' },
  '操作說明': { en: 'Instructions', ja: '操作説明', ko: '사용 방법', fr: 'Mode d’emploi', de: 'Anleitung', es: 'Instrucciones', it: 'Istruzioni' },
  '天氣圖層': { en: 'Weather layer', ja: '天気レイヤー', ko: '날씨 레이어', fr: 'Couche météo', de: 'Wetterebene', es: 'Capa meteorológica', it: 'Layer meteo' },
  '預報模式': { en: 'Forecast model', ja: '予報モデル', ko: '예보 모델', fr: 'Modèle de prévision', de: 'Vorhersagemodell', es: 'Modelo de previsión', it: 'Modello previsionale' },
  '降雨': { en: 'Rain', ja: '雨', ko: '비', fr: 'Pluie', de: 'Regen', es: 'Lluvia', it: 'Pioggia' },
  '雲': { en: 'Clouds', ja: '雲', ko: '구름', fr: 'Nuages', de: 'Wolken', es: 'Nubes', it: 'Nuvole' },
  '在 Windy 開啟「溫度」圖層': { en: 'Open the “Temperature” layer in Windy', ja: 'Windyで「気温」レイヤーを開く', ko: 'Windy에서 “기온” 레이어 열기', fr: 'Ouvrir la couche « Température » dans Windy', de: 'Ebene „Temperatur“ in Windy öffnen', es: 'Abrir la capa “Temperatura” en Windy', it: 'Apri il layer “Temperatura” in Windy' },
  '在 Windy 開啟「降雨」圖層': { en: 'Open the “Rain” layer in Windy', ja: 'Windyで「雨」レイヤーを開く', ko: 'Windy에서 “비” 레이어 열기', fr: 'Ouvrir la couche « Pluie » dans Windy', de: 'Ebene „Regen“ in Windy öffnen', es: 'Abrir la capa “Lluvia” en Windy', it: 'Apri il layer “Pioggia” in Windy' },
  '在 Windy 開啟「風速」圖層': { en: 'Open the “Wind speed” layer in Windy', ja: 'Windyで「風速」レイヤーを開く', ko: 'Windy에서 “풍속” 레이어 열기', fr: 'Ouvrir la couche « Vent » dans Windy', de: 'Ebene „Wind“ in Windy öffnen', es: 'Abrir la capa “Viento” en Windy', it: 'Apri il layer “Vento” in Windy' },
  '在 Windy 開啟「雲」圖層': { en: 'Open the “Clouds” layer in Windy', ja: 'Windyで「雲」レイヤーを開く', ko: 'Windy에서 “구름” 레이어 열기', fr: 'Ouvrir la couche « Nuages » dans Windy', de: 'Ebene „Wolken“ in Windy öffnen', es: 'Abrir la capa “Nubes” en Windy', it: 'Apri il layer “Nuvole” in Windy' },
  '點擊高度圖左方的': { en: 'Use the', ja: '標高グラフ左側の', ko: '고도 그래프 왼쪽의', fr: 'Utilisez le bouton', de: 'Nutze die Schaltfläche', es: 'Usa el botón', it: 'Usa il pulsante' },
  '按鈕，天氣卡可透過': { en: 'button beside the elevation chart. Weather cards use', ja: 'ボタンを押すと、天気カードは', ko: '버튼을 누르면 날씨 카드가', fr: 'à gauche du profil d’altitude. Les cartes météo utilisent', de: 'links am Höhenprofil. Wetterkarten nutzen', es: 'junto al perfil de elevación. Las tarjetas del tiempo usan', it: 'accanto al profilo altimetrico. Le schede meteo usano' },
  '取得：': { en: 'to fetch:', ja: 'から取得します：', ko: '에서 가져옵니다:', fr: 'pour récupérer :', de: 'für den Abruf von:', es: 'para obtener:', it: 'per ottenere:' },
  '預報模式：未來': { en: 'Forecast mode: weather for the next', ja: '予報モード：今後', ko: '예보 모드: 앞으로', fr: 'Mode prévision : météo des', de: 'Vorhersagemodus: Wetter für die nächsten', es: 'Modo previsión: tiempo de los próximos', it: 'Modalità previsione: meteo per i prossimi' },
  '內的天氣。': { en: '.', ja: '分の天気。', ko: '동안의 날씨.', fr: '.', de: '.', es: '.', it: '.' },
  '歷史模式：可追溯至': { en: 'Historical mode: data back to', ja: '履歴モード：', ko: '과거 모드:', fr: 'Mode historique : données depuis', de: 'Historischer Modus: Daten zurück bis', es: 'Modo histórico: datos desde', it: 'Modalità storica: dati dal' },
  '起的資料。': { en: '.', ja: '以降のデータ。', ko: '이후의 데이터.', fr: '.', de: '.', es: '.', it: '.' },
  '設定在': { en: 'Set the default layer and forecast model used when opening', ja: '', ko: '', fr: 'Définissez la couche et le modèle de prévision par défaut utilisés à l’ouverture de', de: 'Lege Ebene und Vorhersagemodell fest, die beim Öffnen in', es: 'Define la capa y el modelo de previsión predeterminados al abrir', it: 'Imposta layer e modello previsionale predefiniti quando apri' },
  '中開啟時預設的圖層與預報模式。': { en: '.', ja: 'で開くときの既定レイヤーと予報モデルを設定します。', ko: '에서 열 때 사용할 기본 레이어와 예보 모델을 설정합니다.', fr: '.', de: 'verwendet werden.', es: '.', it: '.' },
  '註：Windy 本身的預報範圍視其版本而定': { en: 'Note: Windy forecast range depends on the Windy plan', ja: '注：Windy自体の予報期間はプランにより異なります', ko: '참고: Windy 자체 예보 범위는 플랜에 따라 다릅니다', fr: 'Remarque : la portée des prévisions Windy dépend de l’offre Windy', de: 'Hinweis: Der Windy-Vorhersagezeitraum hängt vom Windy-Tarif ab', es: 'Nota: el alcance de previsión de Windy depende del plan de Windy', it: 'Nota: l’intervallo delle previsioni Windy dipende dal piano Windy' },
  '(免費版約': { en: '(free plan about', ja: '（無料版は約', ko: '(무료 플랜은 약', fr: '(offre gratuite environ', de: '(kostenlos etwa', es: '(plan gratuito aprox.', it: '(piano gratuito circa' },
  '，付費版可達': { en: ', paid plan up to', ja: '、有料版は最大', ko: ', 유료 플랜은 최대', fr: ', offre payante jusqu’à', de: ', kostenpflichtig bis zu', es: ', plan de pago hasta', it: ', piano a pagamento fino a' },
  ')。': { en: ').', ja: '）。', ko: ').', fr: ').', de: ').', es: ').', it: ').' },
  '前一天': { en: 'Previous day', ja: '前日', ko: '이전 날', fr: 'Jour précédent', de: 'Voriger Tag', es: 'Día anterior', it: 'Giorno precedente' },
  '後一天': { en: 'Next day', ja: '翌日', ko: '다음 날', fr: 'Jour suivant', de: 'Nächster Tag', es: 'Día siguiente', it: 'Giorno successivo' },
  '前一小時': { en: 'Previous hour', ja: '1時間前', ko: '이전 시간', fr: 'Heure précédente', de: 'Vorige Stunde', es: 'Hora anterior', it: 'Ora precedente' },
  '後一小時': { en: 'Next hour', ja: '1時間後', ko: '다음 시간', fr: 'Heure suivante', de: 'Nächste Stunde', es: 'Hora siguiente', it: 'Ora successiva' },
  '所有日期 ±1 天': { en: 'All dates ±1 day', ja: '全日付 ±1日', ko: '모든 날짜 ±1일', fr: 'Toutes les dates ±1 jour', de: 'Alle Daten ±1 Tag', es: 'Todas las fechas ±1 día', it: 'Tutte le date ±1 giorno' },
  '所有時間 ±1 小時': { en: 'All times ±1 hour', ja: '全時刻 ±1時間', ko: '모든 시간 ±1시간', fr: 'Toutes les heures ±1 h', de: 'Alle Zeiten ±1 Std.', es: 'Todas las horas ±1 h', it: 'Tutti gli orari ±1 h' },
  '起終點海拔': { en: 'Start/end elevation', ja: '起終点標高', ko: '출발/도착 고도', fr: 'Altitude départ/arrivée', de: 'Start-/Zielhöhe', es: 'Altitud inicio/final', it: 'Quota partenza/arrivo' },
  '折返點海拔': { en: 'Turnaround elevation', ja: '折返し点標高', ko: '반환점 고도', fr: 'Altitude du demi-tour', de: 'Umkehrpunkthöhe', es: 'Altitud del retorno', it: 'Quota punto di ritorno' },
  '手機版天氣卡': { en: 'Mobile weather cards', ja: 'モバイル版天気カード', ko: '모바일 날씨 카드', fr: 'Cartes météo mobile', de: 'Wetterkarten mobil', es: 'Tarjetas del tiempo en móvil', it: 'Schede meteo mobile' },
  '上滑': { en: 'Swipe up', ja: '上へスワイプ', ko: '위로 스와이프', fr: 'Balayer vers le haut', de: 'Nach oben wischen', es: 'Deslizar arriba', it: 'Scorri in su' },
  '下滑': { en: 'Swipe down', ja: '下へスワイプ', ko: '아래로 스와이프', fr: 'Balayer vers le bas', de: 'Nach unten wischen', es: 'Deslizar abajo', it: 'Scorri in giù' },
  '左右輕掃': { en: 'Swipe left/right', ja: '左右にスワイプ', ko: '좌우로 스와이프', fr: 'Balayer gauche/droite', de: 'Links/rechts wischen', es: 'Deslizar izq./der.', it: 'Scorri sx/dx' },
  '切換 詳細/簡要 模式': { en: 'switch full/compact mode', ja: '詳細/簡易モードを切り替え', ko: '상세/간단 모드 전환', fr: 'basculer entre détail et compact', de: 'Detail-/Kompaktmodus wechseln', es: 'cambiar modo detallado/compacto', it: 'passa tra dettaglio/compatto' },
  '關閉天氣卡': { en: 'close the weather card', ja: '天気カードを閉じる', ko: '날씨 카드 닫기', fr: 'fermer la carte météo', de: 'Wetterkarte schließen', es: 'cerrar la tarjeta del tiempo', it: 'chiudi la scheda meteo' },
  '切換點位': { en: 'move between points', ja: '地点を切り替え', ko: '지점 전환', fr: 'passer d’un point à l’autre', de: 'zwischen Punkten wechseln', es: 'cambiar de punto', it: 'cambia punto' },
  '標籤與卡片均支援集體連動': { en: 'Labels and cards both support linked bulk actions', ja: 'ラベルとカードは一括連動操作に対応しています', ko: '라벨과 카드는 모두 일괄 연동 작업을 지원합니다', fr: 'Les libellés et cartes prennent en charge les actions groupées', de: 'Labels und Karten unterstützen gekoppelte Sammelaktionen', es: 'Etiquetas y tarjetas admiten acciones en lote vinculadas', it: 'Etichette e schede supportano azioni di gruppo collegate' },
  '電腦版快捷鍵': { en: 'Desktop shortcuts', ja: 'デスクトップショートカット', ko: '데스크톱 단축키', fr: 'Raccourcis clavier', de: 'Desktop-Tastenkürzel', es: 'Atajos de escritorio', it: 'Scorciatoie desktop' },
  '展開/縮放或關閉卡片': { en: 'expand, minimize, or close a card', ja: 'カードを展開/最小化または閉じる', ko: '카드 펼치기/축소 또는 닫기', fr: 'déployer, réduire ou fermer une carte', de: 'Karte erweitern, minimieren oder schließen', es: 'expandir, minimizar o cerrar tarjeta', it: 'espandi, riduci o chiudi una scheda' },
  '左右切換點位': { en: 'switch points left/right', ja: '左右の地点に切り替え', ko: '좌우 지점 전환', fr: 'changer de point à gauche/droite', de: 'Punkte links/rechts wechseln', es: 'cambiar punto izquierda/derecha', it: 'cambia punto a sinistra/destra' },
  '復原 /': { en: 'undo /', ja: '元に戻す /', ko: '실행 취소 /', fr: 'annuler /', de: 'rückgängig /', es: 'deshacer /', it: 'annulla /' },
  '重做': { en: 'redo', ja: 'やり直し', ko: '다시 실행', fr: 'rétablir', de: 'wiederholen', es: 'rehacer', it: 'ripeti' },
  '關閉搜尋結果或選單': { en: 'close search results or menus', ja: '検索結果またはメニューを閉じる', ko: '검색 결과 또는 메뉴 닫기', fr: 'fermer les résultats ou menus', de: 'Suchergebnisse oder Menüs schließen', es: 'cerrar resultados o menús', it: 'chiudi risultati o menu' },
  '航點': { en: 'waypoint', ja: 'ウェイポイント', ko: '웨이포인트', fr: 'waypoint', de: 'Wegpunkt', es: 'waypoint', it: 'waypoint' },
  '軌跡': { en: 'track', ja: '軌跡', ko: '트랙', fr: 'trace', de: 'Track', es: 'traza', it: 'traccia' },
  '天氣卡': { en: 'weather card', ja: '天気カード', ko: '날씨 카드', fr: 'carte météo', de: 'Wetterkarte', es: 'tarjeta del tiempo', it: 'scheda meteo' },
  '游標': { en: 'cursor', ja: 'カーソル', ko: '커서', fr: 'curseur', de: 'Cursor', es: 'cursor', it: 'cursore' },
  '剪貼簿': { en: 'clipboard', ja: 'クリップボード', ko: '클립보드', fr: 'presse-papiers', de: 'Zwischenablage', es: 'portapapeles', it: 'appunti' },
  '拖曳': { en: 'drag', ja: 'ドラッグ', ko: '드래그', fr: 'glisser', de: 'ziehen', es: 'arrastrar', it: 'trascina' },
  '雙擊': { en: 'double-click', ja: 'ダブルクリック', ko: '두 번 클릭', fr: 'double-cliquez', de: 'Doppelklick', es: 'doble clic', it: 'doppio clic' },
  '長按': { en: 'long-press', ja: '長押し', ko: '길게 누르기', fr: 'appui long', de: 'Langdruck', es: 'mantener pulsado', it: 'pressione lunga' },
  '右鍵': { en: 'right-click', ja: '右クリック', ko: '우클릭', fr: 'clic droit', de: 'Rechtsklick', es: 'clic derecho', it: 'clic destro' },
  '展開': { en: 'expand', ja: '展開', ko: '펼치기', fr: 'déployer', de: 'erweitern', es: 'expandir', it: 'espandi' },
  '收合': { en: 'collapse', ja: '折りたたみ', ko: '접기', fr: 'replier', de: 'einklappen', es: 'plegar', it: 'chiudi' },
  '縮小': { en: 'minimize', ja: '小さく', ko: '작게', fr: 'réduire', de: 'verkleinern', es: 'reducir', it: 'riduci' },
  '集體連動': { en: 'linked bulk actions', ja: '一括連動操作', ko: '일괄 연동 작업', fr: 'actions groupées liées', de: 'gekoppelte Sammelaktionen', es: 'acciones en lote vinculadas', it: 'azioni di gruppo collegate' },
  '候選路線': { en: 'route option', ja: '候補ルート', ko: '후보 루트', fr: 'option d’itinéraire', de: 'Routenoption', es: 'opción de ruta', it: 'opzione percorso' },
  '候選卡': { en: 'option card', ja: '候補カード', ko: '후보 카드', fr: 'carte option', de: 'Optionskarte', es: 'tarjeta de opción', it: 'scheda opzione' },
  '主路線': { en: 'main route', ja: '主ルート', ko: '주 루트', fr: 'itinéraire principal', de: 'Hauptroute', es: 'ruta principal', it: 'percorso principale' },
  '移除區': { en: 'Remove zone', ja: '削除エリア', ko: '제거 영역', fr: 'zone Supprimer', de: 'Entfernen-Bereich', es: 'zona Quitar', it: 'zona Rimuovi' },
  '取消區': { en: 'Cancel zone', ja: 'キャンセルエリア', ko: '취소 영역', fr: 'zone Annuler', de: 'Abbrechen-Bereich', es: 'zona Cancelar', it: 'zona Annulla' },
  'GPS 游標與定位': { en: 'GPS cursor and location', ja: 'GPSカーソルと現在地', ko: 'GPS 커서와 위치', fr: 'Curseur GPS et localisation', de: 'GPS-Cursor und Standort', es: 'Cursor GPS y ubicación', it: 'Cursore GPS e posizione' },
  '點擊右側': { en: 'Tap the', ja: '右側の', ko: '오른쪽의', fr: 'Touchez le', de: 'Tippe auf die', es: 'Toca el', it: 'Tocca il' },
  '定位按鈕': { en: 'location button', ja: '現在地ボタン', ko: '위치 버튼', fr: 'bouton de localisation', de: 'Standort-Schaltfläche', es: 'botón de ubicación', it: 'pulsante posizione' },
  '放置游標': { en: 'to place the cursor', ja: 'を押してカーソルを置く', ko: '눌러 커서를 배치', fr: 'pour placer le curseur', de: 'zum Setzen des Cursors', es: 'para colocar el cursor', it: 'per posizionare il cursore' },
  '點擊/長按游標可': { en: 'Tap or long-press the cursor to', ja: 'カーソルをタップ/長押しして', ko: '커서를 탭하거나 길게 눌러', fr: 'Touchez ou appuyez longuement sur le curseur pour', de: 'Tippe oder drücke lang auf den Cursor, um ihn', es: 'Toca o mantén pulsado el cursor para', it: 'Tocca o tieni premuto il cursore per' },
  '或查詢天氣': { en: 'or check weather', ja: '、または天気を確認', ko: '또는 날씨 확인', fr: 'ou consulter la météo', de: 'oder Wetter abzufragen', es: 'o consultar el tiempo', it: 'o controllare il meteo' },
  '我的最愛與匯出': { en: 'Favorites and export', ja: 'お気に入りと書き出し', ko: '즐겨찾기와 내보내기', fr: 'Favoris et export', de: 'Favoriten und Export', es: 'Favoritos y exportación', it: 'Preferiti ed esportazione' },
  '星號': { en: 'star', ja: '星', ko: '별표', fr: 'l’étoile', de: 'Stern', es: 'estrella', it: 'stella' },
  '儲存路線，上限 10 筆': { en: 'to save a route; limit 10 entries', ja: 'でルートを保存（上限10件）', ko: '눌러 루트 저장, 최대 10개', fr: 'pour enregistrer l’itinéraire ; limite de 10', de: 'zum Speichern einer Route, maximal 10 Einträge', es: 'para guardar la ruta; límite de 10', it: 'per salvare il percorso; limite 10' },
  '支援匯出 GPX、KML 與離線地圖包': { en: 'Exports GPX, KML, and offline map packs', ja: 'GPX、KML、オフライン地図パックを書き出せます', ko: 'GPX, KML 및 오프라인 지도 팩 내보내기 지원', fr: 'Export GPX, KML et packs de cartes hors ligne', de: 'Exportiert GPX, KML und Offline-Kartenpakete', es: 'Exporta GPX, KML y paquetes de mapas offline', it: 'Esporta GPX, KML e pacchetti mappa offline' },
  '路線規劃說明': { en: 'Route planning tips', ja: 'ルート計画のヒント', ko: '루트 계획 안내', fr: 'Conseils de planification', de: 'Hinweise zur Routenplanung', es: 'Consejos de planificación', it: 'Suggerimenti percorso' },
  '依序點選地圖即可建立航點；拖曳航點可微調路線位置': { en: 'Click the map in order to create waypoints; drag waypoints to fine-tune the route', ja: '地図を順にクリックしてウェイポイントを作成し、ドラッグしてルート位置を微調整できます', ko: '지도에서 순서대로 클릭해 웨이포인트를 만들고, 드래그해 루트 위치를 조정합니다', fr: 'Cliquez sur la carte dans l’ordre pour créer des waypoints ; faites-les glisser pour ajuster l’itinéraire', de: 'Klicke der Reihe nach auf die Karte, um Wegpunkte zu setzen; ziehe Wegpunkte zur Feinabstimmung', es: 'Haz clic en el mapa en orden para crear waypoints; arrástralos para ajustar la ruta', it: 'Fai clic sulla mappa in sequenza per creare waypoint; trascinali per rifinire il percorso' },
  '適合 A 到 B；': { en: 'is for A-to-B routes;', ja: 'はAからB向き、', ko: '는 A에서 B까지;', fr: 'convient aux itinéraires A vers B ;', de: 'ist für A-nach-B-Routen;', es: 'sirve para rutas de A a B;', it: 'è per percorsi da A a B;' },
  '會自動折返；': { en: 'automatically returns;', ja: 'は自動で往復、', ko: '는 자동으로 왕복;', fr: 'revient automatiquement ;', de: 'kehrt automatisch zurück;', es: 'regresa automáticamente;', it: 'torna automaticamente;' },
  '會尋找回到起點的替代路線': { en: 'finds an alternate route back to the start', ja: 'は起点へ戻る代替ルートを探します', ko: '는 출발점으로 돌아가는 대체 루트를 찾습니다', fr: 'trouve un itinéraire alternatif vers le départ', de: 'findet eine Alternativroute zurück zum Start', es: 'busca una ruta alternativa de regreso al inicio', it: 'trova un percorso alternativo per tornare alla partenza' },
  '若出現多條候選路線，可點選候選卡或地圖上的軌跡切換主路線': { en: 'If multiple options appear, choose an option card or map track to switch the main route', ja: '複数候補が出た場合は、候補カードまたは地図上の軌跡を選んで主ルートを切り替えます', ko: '여러 후보 루트가 나오면 후보 카드나 지도 트랙을 선택해 주 루트를 전환하세요', fr: 'Si plusieurs options apparaissent, choisissez une carte ou une trace sur la carte pour changer l’itinéraire principal', de: 'Bei mehreren Optionen wähle eine Optionskarte oder Kartenroute, um die Hauptroute zu wechseln', es: 'Si aparecen varias opciones, elige una tarjeta o traza del mapa para cambiar la ruta principal', it: 'Se appaiono più opzioni, scegli una scheda o traccia sulla mappa per cambiare il percorso principale' },
  '天氣資料說明': { en: 'Weather data notes', ja: '天気データの注意', ko: '날씨 데이터 안내', fr: 'Notes météo', de: 'Hinweise zu Wetterdaten', es: 'Notas sobre el tiempo', it: 'Note dati meteo' },
  '短期預報優先參考 Open-Meteo；需要比對模式時可切換 Windy 模型': { en: 'Use Open-Meteo as the primary short-range forecast; switch Windy models when comparing forecasts', ja: '短期予報はOpen-Meteoを優先し、比較が必要な場合はWindyモデルを切り替えます', ko: '단기 예보는 Open-Meteo를 우선 참고하고, 비교가 필요하면 Windy 모델을 전환하세요', fr: 'Pour le court terme, privilégiez Open-Meteo ; changez de modèle Windy pour comparer', de: 'Für Kurzfristprognosen primär Open-Meteo nutzen; Windy-Modelle zum Vergleich wechseln', es: 'Usa Open-Meteo como referencia principal a corto plazo; cambia modelos Windy para comparar', it: 'Per il breve termine usa Open-Meteo; cambia modello Windy per confrontare' },
  '天氣卡顯示的是航點附近資料，山區微地形與稜線風仍需現地判斷': { en: 'Weather cards show data near each waypoint; mountain microterrain and ridge winds still require field judgment', ja: '天気カードは各ウェイポイント付近のデータです。山岳の微地形や稜線風は現地判断が必要です', ko: '날씨 카드는 각 웨이포인트 주변 데이터이며, 산악 미세지형과 능선 바람은 현장 판단이 필요합니다', fr: 'Les cartes météo montrent les données près des waypoints ; microrelief et vents de crête exigent un jugement sur place', de: 'Wetterkarten zeigen Daten nahe der Wegpunkte; Mikrogelände und Gratwind erfordern weiterhin Beurteilung vor Ort', es: 'Las tarjetas muestran datos cerca de cada waypoint; el microrelieve y viento de cresta requieren juicio en terreno', it: 'Le schede mostrano dati vicino ai waypoint; microterreno e vento di cresta richiedono valutazione sul posto' },
  '出發前建議重整資料，並留意降雨、體感溫度、陣風與雷雨指標': { en: 'Refresh data before departure and watch rain, feels-like temperature, gusts, and thunderstorm indicators', ja: '出発前にデータを更新し、雨、体感温度、突風、雷雨指標に注意してください', ko: '출발 전 데이터를 새로고침하고 비, 체감 온도, 돌풍, 뇌우 지표를 확인하세요', fr: 'Actualisez avant le départ et surveillez pluie, ressenti, rafales et orages', de: 'Vor dem Aufbruch Daten aktualisieren und Regen, Gefühlttemperatur, Böen und Gewitter beachten', es: 'Actualiza antes de salir y vigila lluvia, sensación térmica, rachas y tormentas', it: 'Aggiorna prima della partenza e controlla pioggia, percepita, raffiche e temporali' },
  '估時小提醒': { en: 'Estimated time notes', ja: '所要時間のメモ', ko: '예상 시간 참고', fr: 'Notes sur le temps estimé', de: 'Hinweise zur geschätzten Zeit', es: 'Notas de tiempo estimado', it: 'Note sul tempo stimato' },
  '配速估算會受到坡度、距離、負重、休息與疲勞設定影響': { en: 'Pace estimates are affected by grade, distance, pack weight, rest, and fatigue settings', ja: 'ペース推定は勾配、距離、荷重、休憩、疲労設定の影響を受けます', ko: '페이스 추정은 경사, 거리, 배낭 무게, 휴식, 피로 설정의 영향을 받습니다', fr: 'L’estimation dépend de la pente, distance, charge, pauses et fatigue', de: 'Die Schätzung hängt von Steigung, Distanz, Rucksackgewicht, Pausen und Ermüdung ab', es: 'La estimación depende de pendiente, distancia, carga, descansos y fatiga', it: 'La stima dipende da pendenza, distanza, carico, pause e fatica' },
  '匯入自己的 GPX/KML 並填入實際耗時，可建立更貼近個人體感的校正倍率': { en: 'Import your own GPX/KML and enter actual elapsed time to build a more personal calibration factor', ja: '自分のGPX/KMLを読み込み実際の所要時間を入力すると、体感に近い補正倍率を作成できます', ko: '자신의 GPX/KML을 가져와 실제 소요 시간을 입력하면 개인 체감에 가까운 보정 배율을 만들 수 있습니다', fr: 'Importez vos GPX/KML et saisissez le temps réel pour créer un facteur de calibration personnel', de: 'Importiere eigene GPX/KML und reale Zeiten, um einen persönlichen Kalibrierfaktor zu erstellen', es: 'Importa tus GPX/KML e introduce tiempos reales para crear un factor de calibración personal', it: 'Importa GPX/KML personali e inserisci il tempo reale per creare un fattore di calibrazione' },
  '估時適合做行程規劃基準；困難地形、摸黑、濕滑路況請預留額外時間': { en: 'Use estimates as a planning baseline; allow extra time for difficult terrain, darkness, or wet/slippery conditions', ja: '所要時間は計画の目安です。難地形、夜間、濡れた滑りやすい道では余裕を見てください', ko: '예상 시간은 계획 기준입니다. 어려운 지형, 야간, 젖거나 미끄러운 길은 여유 시간을 두세요', fr: 'Servez-vous-en comme base ; prévoyez plus de temps pour terrain difficile, nuit ou sol humide/glissant', de: 'Als Planungsbasis nutzen; für schwieriges Gelände, Dunkelheit oder nasse/rutschige Wege mehr Zeit einplanen', es: 'Úsalo como base de planificación; añade margen en terreno difícil, noche o suelo mojado/resbaladizo', it: 'Usale come base; aggiungi margine per terreno difficile, buio o fondo bagnato/scivoloso' },
  '離線地圖包提醒': { en: 'Offline map pack notes', ja: 'オフライン地図パックの注意', ko: '오프라인 지도 팩 참고', fr: 'Notes sur les packs hors ligne', de: 'Hinweise zu Offline-Kartenpaketen', es: 'Notas de paquetes offline', it: 'Note pacchetti offline' },
  '.melmap 可保存路線、航點、目前圖層圖磚與部分個人偏好': { en: '.melmap can save the route, waypoints, current layer tiles, and some personal preferences', ja: '.melmapはルート、ウェイポイント、現在レイヤーのタイル、一部の個人設定を保存できます', ko: '.melmap은 루트, 웨이포인트, 현재 레이어 타일 및 일부 개인 설정을 저장할 수 있습니다', fr: '.melmap peut enregistrer itinéraire, waypoints, tuiles de la couche actuelle et certaines préférences', de: '.melmap speichert Route, Wegpunkte, aktuelle Layer-Kacheln und einige persönliche Einstellungen', es: '.melmap guarda ruta, waypoints, teselas de la capa actual y algunas preferencias', it: '.melmap salva percorso, waypoint, tile del layer corrente e alcune preferenze' },
  '離線圖磚只會包含匯出當下選取的範圍與縮放層級': { en: 'Offline tiles only include the selected area and zoom levels at export time', ja: 'オフラインタイルは書き出し時に選択した範囲とズームレベルのみ含みます', ko: '오프라인 타일은 내보내기 시 선택한 범위와 확대 수준만 포함합니다', fr: 'Les tuiles hors ligne ne couvrent que la zone et les niveaux de zoom sélectionnés à l’export', de: 'Offline-Kacheln enthalten nur den beim Export gewählten Bereich und Zoomstufen', es: 'Las teselas offline solo incluyen el área y niveles de zoom seleccionados al exportar', it: 'Le tile offline includono solo area e livelli di zoom scelti all’esportazione' },
  '地圖包可能較大；出發前請先匯入測試，確認路線與圖層都能正常開啟': { en: 'Map packs may be large; import and test before departure to confirm the route and layers open correctly', ja: '地図パックは大きくなる場合があります。出発前に読み込んでルートとレイヤーを確認してください', ko: '지도 팩은 클 수 있습니다. 출발 전 가져와 테스트하여 루트와 레이어가 정상적으로 열리는지 확인하세요', fr: 'Les packs peuvent être volumineux ; importez et testez avant le départ', de: 'Kartenpakete können groß sein; vor dem Aufbruch importieren und Route/Layer prüfen', es: 'Los paquetes pueden ser grandes; impórtalos y pruébalos antes de salir', it: 'I pacchetti possono essere grandi; importali e testali prima della partenza' },
  '使用者小提示': { en: 'User tips', ja: 'ユーザー向けヒント', ko: '사용자 팁', fr: 'Conseils utilisateur', de: 'Nutzertipps', es: 'Consejos de uso', it: 'Suggerimenti utente' },
  '快速複製': { en: 'Quick copy', ja: 'クイックコピー', ko: '빠른 복사', fr: 'Copie rapide', de: 'Schnell kopieren', es: 'Copia rápida', it: 'Copia rapida' },
  '點擊任何座標、GPS 游標或天氣卡中的經緯度，即可複製到剪貼簿': { en: 'Click any coordinate, GPS cursor, or latitude/longitude in a weather card to copy it to the clipboard', ja: '座標、GPSカーソル、天気カード内の緯度/経度をクリックするとクリップボードへコピーできます', ko: '좌표, GPS 커서 또는 날씨 카드의 위도/경도를 클릭하면 클립보드에 복사됩니다', fr: 'Cliquez sur une coordonnée, le curseur GPS ou une latitude/longitude de carte météo pour la copier', de: 'Klicke auf Koordinaten, den GPS-Cursor oder Breite/Länge in einer Wetterkarte, um sie zu kopieren', es: 'Haz clic en cualquier coordenada, cursor GPS o latitud/longitud de una tarjeta del tiempo para copiarla', it: 'Fai clic su coordinate, cursore GPS o latitudine/longitudine in una scheda meteo per copiarle' },
  '收起也能找點': { en: 'Search while collapsed', ja: '折りたたみ中も検索', ko: '접은 상태에서도 검색', fr: 'Recherche volet replié', de: 'Suche im eingeklappten Zustand', es: 'Buscar plegado', it: 'Cerca da chiuso' },
  '側欄收起時，點頂部標題仍可搜尋地點、切換運動或天氣模式': { en: 'When the sidebar is collapsed, tap the top title to search places or switch activity/weather mode', ja: 'サイドバーを折りたたんだ状態でも、上部タイトルから場所検索やアクティビティ/天気モード切替ができます', ko: '사이드바가 접힌 상태에서도 상단 제목을 눌러 장소 검색 또는 활동/날씨 모드를 전환할 수 있습니다', fr: 'Volet replié, touchez le titre supérieur pour chercher un lieu ou changer de mode activité/météo', de: 'Bei eingeklappter Seitenleiste über den oberen Titel Orte suchen oder Aktivitäts-/Wettermodus wechseln', es: 'Con la barra plegada, toca el título superior para buscar lugares o cambiar actividad/tiempo', it: 'Con la barra chiusa, tocca il titolo in alto per cercare luoghi o cambiare modalità attività/meteo' },
  '同步查看高度': { en: 'Sync elevation view', ja: '標高を同期表示', ko: '고도 보기 동기화', fr: 'Profil synchronisé', de: 'Höhenansicht synchronisieren', es: 'Vista de elevación sincronizada', it: 'Vista quota sincronizzata' },
  '拖曳高度圖游標可同步高亮地圖位置；雙擊高度圖可快速收放面板': { en: 'Drag the elevation cursor to highlight the matching map position; double-click the profile to collapse or expand the panel', ja: '標高グラフのカーソルをドラッグすると地図上の対応位置が強調表示され、ダブルクリックでパネルを開閉できます', ko: '고도 그래프 커서를 드래그하면 지도 위치가 함께 강조되고, 그래프를 두 번 클릭하면 패널을 접거나 펼칠 수 있습니다', fr: 'Faites glisser le curseur du profil pour surligner le point sur la carte ; double-cliquez pour replier/déployer le panneau', de: 'Ziehe den Höhenprofil-Cursor, um die Kartenposition zu markieren; doppelklicke das Profil, um das Panel ein- oder auszuklappen', es: 'Arrastra el cursor del perfil para resaltar el punto en el mapa; doble clic para plegar o desplegar el panel', it: 'Trascina il cursore del profilo per evidenziare il punto sulla mappa; doppio clic per chiudere o aprire il pannello' },
  '快速編輯航點': { en: 'Quick waypoint edits', ja: 'ウェイポイントを素早く編集', ko: '웨이포인트 빠른 편집', fr: 'Édition rapide des waypoints', de: 'Wegpunkte schnell bearbeiten', es: 'Edición rápida de waypoints', it: 'Modifica rapida waypoint' },
  '雙擊側欄或表頭的': { en: 'Double-click the sidebar or table-header', ja: 'サイドバーまたは表ヘッダーの', ko: '사이드바 또는 표 머리글의', fr: 'Double-cliquez le', de: 'Doppelklicke in Seitenleiste oder Tabellenkopf auf', es: 'Doble clic en el', it: 'Fai doppio clic sul' },
  '名稱': { en: 'name', ja: '名前', ko: '이름', fr: 'nom', de: 'Name', es: 'nombre', it: 'nome' },
  '可改名；長按或右鍵地圖航點可拖曳微調': { en: 'to rename it; long-press or right-click a map waypoint to drag and fine-tune it', ja: 'を変更できます。地図上のウェイポイントは長押しまたは右クリックでドラッグ調整できます', ko: '을 변경할 수 있고, 지도 웨이포인트를 길게 누르거나 우클릭하면 드래그해 조정할 수 있습니다', fr: 'pour le renommer ; appui long ou clic droit sur un waypoint pour le déplacer', de: 'um ihn umzubenennen; Wegpunkt auf der Karte lang drücken oder rechtsklicken und fein verschieben', es: 'para renombrarlo; mantén pulsado o haz clic derecho en un waypoint para arrastrarlo y ajustarlo', it: 'per rinominarlo; pressione lunga o clic destro su un waypoint per trascinarlo e regolarlo' },
  '重疊層級切換': { en: 'Overlap layer switching', ja: '重なり順の切り替え', ko: '겹침 레이어 전환', fr: 'Changer les couches superposées', de: 'Überlappende Ebenen wechseln', es: 'Cambiar capas superpuestas', it: 'Cambio livelli sovrapposti' },
  '重疊軌跡可雙擊軌跡輪換上下層；重疊航點可雙擊航點切換顯示層級，已選取時再點一次也會輪換；長按或右鍵航點只會拖曳微調': { en: 'For overlapping tracks, double-click the track to rotate the visible layer; for overlapping waypoints, double-click the waypoint to switch the visible layer, or click it again when already selected; long-press or right-click only drags and fine-tunes the waypoint', ja: '重なった軌跡は軌跡をダブルクリックすると表示レイヤーを切り替えます。重なったウェイポイントはダブルクリックで表示レイヤーを切り替え、選択済みならもう一度クリックしても切り替わります。長押しまたは右クリックはドラッグ調整だけに使います', ko: '겹친 트랙은 트랙을 두 번 클릭해 보이는 레이어를 순환합니다. 겹친 웨이포인트는 두 번 클릭해 표시 레이어를 바꾸고, 이미 선택된 상태에서는 다시 클릭해도 순환합니다. 길게 누르기나 우클릭은 웨이포인트 드래그 조정에만 사용됩니다', fr: 'Pour les traces superposées, double-cliquez la trace pour faire tourner la couche visible ; pour les waypoints superposés, double-cliquez le waypoint, ou cliquez-le encore s’il est déjà sélectionné ; l’appui long ou le clic droit ne sert qu’au déplacement fin', de: 'Bei überlappenden Tracks per Doppelklick auf den Track die sichtbare Ebene wechseln; bei überlappenden Wegpunkten per Doppelklick wechseln, oder erneut klicken, wenn er schon ausgewählt ist; Langdruck oder Rechtsklick dient nur zum Ziehen und Feinjustieren', es: 'En trazas superpuestas, haz doble clic en la traza para rotar la capa visible; en waypoints superpuestos, haz doble clic en el waypoint, o vuelve a hacer clic si ya está seleccionado; mantener pulsado o clic derecho solo arrastra y ajusta el waypoint', it: 'Per tracce sovrapposte, fai doppio clic sulla traccia per ruotare il livello visibile; per waypoint sovrapposti, fai doppio clic sul waypoint, oppure cliccalo di nuovo se è già selezionato; pressione lunga o clic destro servono solo a trascinare e regolare' },
  '天氣卡操作': { en: 'Weather card controls', ja: '天気カード操作', ko: '날씨 카드 조작', fr: 'Commandes des cartes météo', de: 'Wetterkarten steuern', es: 'Controles de tarjetas del tiempo', it: 'Comandi schede meteo' },
  '大格可點天氣圖示或下滑關閉、點空白處縮小，且只操作目前卡片；小格可點資訊展開、點圖示關閉，會依集體設定連動；再次開啟會記住大格或小格': { en: 'Full cards close from the weather icon or swipe down, shrink from blank space, and affect only the current card; compact cards expand from the info area, close from the icon, follow bulk settings, and reopen at the remembered size', ja: '大きなカードは天気アイコンまたは下スワイプで閉じ、空白部分で小さくなり、現在のカードだけに作用します。小さなカードは情報部分で展開、アイコンで閉じ、一括設定に連動し、再表示時は前回の大きさを記憶します', ko: '큰 카드는 날씨 아이콘이나 아래로 스와이프해서 닫고, 빈 공간을 누르면 작아지며 현재 카드에만 적용됩니다. 작은 카드는 정보 영역을 눌러 펼치고 아이콘으로 닫으며, 일괄 설정을 따르고 다시 열 때 이전 크기를 기억합니다', fr: 'Les grandes cartes se ferment par l’icône météo ou un balayage vers le bas, se réduisent via l’espace vide et n’agissent que sur la carte courante ; les cartes compactes s’ouvrent via les infos, se ferment par l’icône, suivent les réglages groupés et mémorisent leur taille', de: 'Große Karten schließen über das Wettersymbol oder Wischen nach unten, verkleinern sich über Leerfläche und betreffen nur die aktuelle Karte; kompakte Karten öffnen über den Infobereich, schließen über das Symbol, folgen den Sammelaktionen und merken sich ihre Größe', es: 'Las tarjetas grandes se cierran con el icono del tiempo o deslizando abajo, se reducen tocando espacio vacío y solo afectan a la tarjeta actual; las compactas se abren desde la información, se cierran con el icono, siguen los ajustes en lote y recuerdan su tamaño', it: 'Le schede grandi si chiudono dall’icona meteo o scorrendo verso il basso, si riducono toccando lo spazio vuoto e agiscono solo sulla scheda corrente; le compatte si aprono dai dati, si chiudono dall’icona, seguono le impostazioni di gruppo e ricordano la dimensione' },
  '批次天氣卡': { en: 'Batch weather cards', ja: '天気カードの一括操作', ko: '날씨 카드 일괄 작업', fr: 'Cartes météo en lot', de: 'Wetterkarten gesammelt steuern', es: 'Tarjetas del tiempo en lote', it: 'Schede meteo in gruppo' },
  '在「航點設置」勾選連動對象後，收合、展開或關閉會套用到整組天氣卡': { en: 'After choosing linked targets in “Waypoint settings”, collapse, expand, or close applies to the whole weather-card group', ja: '「ウェイポイント設定」で連動対象を選ぶと、折りたたみ、展開、閉じる操作が天気カード全体に適用されます', ko: '“웨이포인트 설정”에서 연동 대상을 선택하면 접기, 펼치기, 닫기가 날씨 카드 그룹 전체에 적용됩니다', fr: 'Après avoir choisi les cibles liées dans « Réglages des waypoints », replier, déployer ou fermer agit sur tout le groupe météo', de: 'Nach Auswahl gekoppelter Ziele in „Wegpunkt-Einstellungen“ gilt Einklappen, Ausklappen oder Schließen für die ganze Wetterkartengruppe', es: 'Tras elegir objetivos vinculados en “Ajustes de waypoints”, plegar, desplegar o cerrar se aplica a todo el grupo', it: 'Dopo aver scelto i target in “Impostazioni waypoint”, chiudi, apri o minimizza tutto il gruppo meteo' },
  '拖曳刪除與取消': { en: 'Drag to delete or cancel', ja: 'ドラッグで削除・キャンセル', ko: '드래그 삭제/취소', fr: 'Glisser pour supprimer ou annuler', de: 'Ziehen zum Löschen oder Abbrechen', es: 'Arrastrar para borrar o cancelar', it: 'Trascina per eliminare o annullare' },
  '地圖航點、側欄與表格項目拖曳時會出現取消與移除區；拖到移除區刪除，拖到取消區取消本次拖曳；最愛項目拖出框外刪除，放回框內取消': { en: 'When dragging map waypoints, sidebar items, or table items, cancel and remove zones appear; drop on Remove to delete, or on Cancel to cancel this drag; drag favorite items outside the box to delete them, or back inside to cancel', ja: '地図上のウェイポイント、サイドバー項目、表項目をドラッグすると、キャンセルと削除エリアが表示されます。削除エリアへ落とすと削除、キャンセルエリアへ落とすと今回のドラッグを取り消します。お気に入り項目は枠外へドラッグすると削除、枠内へ戻すとキャンセルします', ko: '지도 웨이포인트, 사이드바 항목, 표 항목을 드래그하면 취소와 제거 영역이 나타납니다. 제거 영역에 놓으면 삭제되고, 취소 영역에 놓으면 이번 드래그가 취소됩니다. 즐겨찾기 항목은 상자 밖으로 드래그하면 삭제되고, 안으로 되돌리면 취소됩니다', fr: 'Quand vous faites glisser un waypoint de carte, un élément du volet ou du tableau, des zones Annuler et Supprimer apparaissent ; déposez sur Supprimer pour effacer, ou sur Annuler pour annuler ce glisser ; sortez un favori du cadre pour le supprimer, ou remettez-le dedans pour annuler', de: 'Beim Ziehen von Karten-Wegpunkten sowie Seitenleisten- oder Tabelleneinträgen erscheinen Bereiche für Abbrechen und Entfernen; auf Entfernen ablegen löscht, auf Abbrechen legt den aktuellen Ziehvorgang zurück; Favoriten außerhalb des Rahmens ziehen löscht sie, zurück im Rahmen bricht ab', es: 'Al arrastrar waypoints del mapa, elementos de la barra o de la tabla aparecen zonas de cancelar y quitar; suelta en Quitar para borrar, o en Cancelar para cancelar este arrastre; arrastra favoritos fuera del cuadro para borrarlos, o devuélvelos dentro para cancelar', it: 'Quando trascini waypoint della mappa, elementi laterali o della tabella compaiono le zone Annulla e Rimuovi; rilascia su Rimuovi per eliminare, o su Annulla per annullare il trascinamento; trascina i preferiti fuori dal riquadro per eliminarli, o riportali dentro per annullare' },
  '勾選全航點時將自動包含前兩項': { en: 'Selecting all waypoints also includes the first two options', ja: '全ウェイポイントを選ぶと前2項目も含まれます', ko: '모든 웨이포인트를 선택하면 앞의 두 항목도 포함됩니다', fr: 'Tous les waypoints inclut aussi les deux premières options', de: 'Alle Wegpunkte umfasst auch die ersten beiden Optionen', es: 'Todos los waypoints incluye también las dos primeras opciones', it: 'Tutti i waypoint include anche le prime due opzioni' },
  '勾選的天氣卡收縮為最小模式': { en: 'Minimize selected weather cards', ja: '選択した天気カードを最小化', ko: '선택한 날씨 카드 최소화', fr: 'Réduire les cartes météo sélectionnées', de: 'Ausgewählte Wetterkarten minimieren', es: 'Minimizar tarjetas seleccionadas', it: 'Riduci schede meteo selezionate' },
  '勾選的天氣卡切換詳細/精簡': { en: 'Toggle selected cards between full and compact', ja: '選択カードの詳細/簡易を切り替え', ko: '선택한 카드의 상세/간단 전환', fr: 'Basculer les cartes sélectionnées détail/compact', de: 'Ausgewählte Karten Detail/Kompakt umschalten', es: 'Cambiar seleccionadas entre detalle/compacto', it: 'Alterna selezionate tra dettaglio/compatto' },
  '在地圖上顯示主航點的天氣圖示': { en: 'Show weather icons for main waypoints on the map', ja: '地図に主要ウェイポイントの天気アイコンを表示', ko: '지도에 주요 웨이포인트 날씨 아이콘 표시', fr: 'Afficher les icônes météo des waypoints principaux', de: 'Wettersymbole für Hauptwegpunkte auf der Karte anzeigen', es: 'Mostrar iconos del tiempo de waypoints principales', it: 'Mostra icone meteo dei waypoint principali' },
  '在地圖上顯示中繼點的天氣圖示': { en: 'Show weather icons for intermediate points on the map', ja: '地図に中間点の天気アイコンを表示', ko: '지도에 중간 지점 날씨 아이콘 표시', fr: 'Afficher les icônes météo des points intermédiaires', de: 'Wettersymbole für Zwischenpunkte auf der Karte anzeigen', es: 'Mostrar iconos del tiempo de puntos intermedios', it: 'Mostra icone meteo dei punti intermedi' },
  '點擊航點高亮時，地圖自動移動讓該點顯示在中央': { en: 'When highlighting a waypoint, pan the map to center it', ja: 'ウェイポイントをハイライトしたとき地図を中央へ移動', ko: '웨이포인트 강조 시 지도가 해당 지점을 중앙에 맞춤', fr: 'Au surlignage d’un waypoint, recentrer la carte dessus', de: 'Beim Hervorheben eines Wegpunkts Karte darauf zentrieren', es: 'Al resaltar un waypoint, centrarlo en el mapa', it: 'Quando evidenzi un waypoint, centra la mappa' },
  '匯入僅含座標的檔案時,自動以 TSP 重新排序航點': { en: 'For coordinate-only imports, automatically reorder waypoints with TSP', ja: '座標のみのインポート時、TSPでウェイポイントを自動並べ替え', ko: '좌표만 있는 파일을 가져올 때 TSP로 웨이포인트 자동 정렬', fr: 'Pour les imports avec coordonnées seules, réordonner les waypoints par TSP', de: 'Bei Importen nur mit Koordinaten Wegpunkte automatisch per TSP sortieren', es: 'Para importaciones solo con coordenadas, reordenar waypoints con TSP', it: 'Per import con sole coordinate, riordina waypoint con TSP' },
  '匯入時,為沒有名稱的航點自動命名': { en: 'Automatically name unnamed waypoints on import', ja: 'インポート時に名前のないウェイポイントを自動命名', ko: '가져오기 시 이름 없는 웨이포인트 자동 이름 지정', fr: 'Nommer automatiquement les waypoints sans nom à l’import', de: 'Unbenannte Wegpunkte beim Import automatisch benennen', es: 'Nombrar automáticamente waypoints sin nombre al importar', it: 'Nomina automaticamente waypoint senza nome all’import' },
  '進度': { en: 'Progress', ja: '進捗', ko: '진행률', fr: 'Progression', de: 'Fortschritt', es: 'Progreso', it: 'Avanzamento' },
  '我愛星空至深，無懼黑夜。': STRINGS['quote.translation'],
  '問題回報': { en: 'Feedback', ja: 'フィードバック', ko: '피드백', fr: 'Retour', de: 'Feedback', es: 'Comentarios', it: 'Feedback' },
  '使用人數': { en: 'Visitors', ja: '利用者数', ko: '사용자 수', fr: 'Visiteurs', de: 'Nutzende', es: 'Visitantes', it: 'Visitatori' },
  '匯入離線地圖包': { en: 'Import offline map pack', ja: 'オフライン地図パックをインポート', ko: '오프라인 지도 팩 가져오기', fr: 'Importer un pack de cartes hors ligne', de: 'Offline-Kartenpaket importieren', es: 'Importar paquete de mapas offline', it: 'Importa pacchetto mappe offline' },
  '我的最愛': { en: 'Favorites', ja: 'お気に入り', ko: '즐겨찾기', fr: 'Favoris', de: 'Favoriten', es: 'Favoritos', it: 'Preferiti' },
  '取消': { en: 'Cancel', ja: 'キャンセル', ko: '취소', fr: 'Annuler', de: 'Abbrechen', es: 'Cancelar', it: 'Annulla' },
  '匯出': { en: 'Export', ja: '書き出し', ko: '내보내기', fr: 'Exporter', de: 'Exportieren', es: 'Exportar', it: 'Esporta' },
  '套用': { en: 'Apply', ja: '適用', ko: '적용', fr: 'Appliquer', de: 'Anwenden', es: 'Aplicar', it: 'Applica' },
  '關閉': { en: 'Close', ja: '閉じる', ko: '닫기', fr: 'Fermer', de: 'Schließen', es: 'Cerrar', it: 'Chiudi' },
  '點擊': { en: 'Click', ja: 'クリックして', ko: '클릭해', fr: 'Cliquez sur', de: 'Klicke auf', es: 'Haz clic en', it: 'Fai clic su' },
  '更新天氣': { en: 'Update weather', ja: '天気を更新', ko: '날씨 업데이트', fr: 'Mettre à jour la météo', de: 'Wetter aktualisieren', es: 'Actualizar tiempo', it: 'Aggiorna meteo' },
  '取得天氣中…': { en: 'Fetching weather…', ja: '天気を取得中…', ko: '날씨를 가져오는 중…', fr: 'Météo en cours…', de: 'Wetter wird abgerufen…', es: 'Obteniendo tiempo…', it: 'Recupero meteo…' },
  '取得失敗': { en: 'Fetch failed', ja: '取得に失敗', ko: '가져오기 실패', fr: 'Échec', de: 'Abruf fehlgeschlagen', es: 'Error al obtener', it: 'Recupero non riuscito' },
  '天氣': { en: 'Weather', ja: '天気', ko: '날씨', fr: 'Météo', de: 'Wetter', es: 'Tiempo', it: 'Meteo' },
  '坐標': { en: 'Coordinates', ja: '座標', ko: '좌표', fr: 'Coordonnées', de: 'Koordinaten', es: 'Coordenadas', it: 'Coordinate' },
  '座標': { en: 'Coordinates', ja: '座標', ko: '좌표', fr: 'Coordonnées', de: 'Koordinaten', es: 'Coordenadas', it: 'Coordinate' },
  '點擊複製': { en: 'Click to copy', ja: 'クリックしてコピー', ko: '클릭하여 복사', fr: 'Cliquer pour copier', de: 'Zum Kopieren klicken', es: 'Clic para copiar', it: 'Fai clic per copiare' },
  '點擊複製座標': { en: 'Click to copy coordinates', ja: 'クリックして座標をコピー', ko: '클릭하여 좌표 복사', fr: 'Cliquer pour copier les coordonnées', de: 'Koordinaten kopieren', es: 'Clic para copiar coordenadas', it: 'Fai clic per copiare coordinate' },
  '在 Windy 開啟': { en: 'Open in Windy', ja: 'Windyで開く', ko: 'Windy에서 열기', fr: 'Ouvrir dans Windy', de: 'In Windy öffnen', es: 'Abrir en Windy', it: 'Apri in Windy' },
  '開啟 Windy': { en: 'Open Windy', ja: 'Windyを開く', ko: 'Windy 열기', fr: 'Ouvrir Windy', de: 'Windy öffnen', es: 'Abrir Windy', it: 'Apri Windy' },
  '設為航點': { en: 'Set as waypoint', ja: 'ウェイポイントに設定', ko: '웨이포인트로 설정', fr: 'Définir comme waypoint', de: 'Als Wegpunkt setzen', es: 'Definir como waypoint', it: 'Imposta come waypoint' },
  '開啟天氣卡': { en: 'Open weather card', ja: '天気カードを開く', ko: '날씨 카드 열기', fr: 'Ouvrir la carte météo', de: 'Wetterkarte öffnen', es: 'Abrir tarjeta del tiempo', it: 'Apri scheda meteo' },
  '清除 GPS 游標': { en: 'Clear GPS cursor', ja: 'GPSカーソルを消去', ko: 'GPS 커서 지우기', fr: 'Effacer le curseur GPS', de: 'GPS-Cursor löschen', es: 'Borrar cursor GPS', it: 'Cancella cursore GPS' },
  '關閉選單': { en: 'Close menu', ja: 'メニューを閉じる', ko: '메뉴 닫기', fr: 'Fermer le menu', de: 'Menü schließen', es: 'Cerrar menú', it: 'Chiudi menu' },
  '拖曳至此刪除': { en: 'Drag here to delete', ja: 'ここへドラッグして削除', ko: '여기로 끌어 삭제', fr: 'Glisser ici pour supprimer', de: 'Zum Löschen hierher ziehen', es: 'Arrastra aquí para borrar', it: 'Trascina qui per eliminare' },
  '線上模式': { en: 'Online mode', ja: 'オンラインモード', ko: '온라인 모드', fr: 'Mode en ligne', de: 'Online-Modus', es: 'Modo en línea', it: 'Modalità online' },
  '離線模式': { en: 'Offline mode', ja: 'オフラインモード', ko: '오프라인 모드', fr: 'Mode hors ligne', de: 'Offline-Modus', es: 'Modo sin conexión', it: 'Modalità offline' },
  '快取瓦片：不支援': { en: 'Cached tiles: not supported', ja: 'キャッシュタイル：非対応', ko: '캐시 타일: 지원 안 됨', fr: 'Tuiles en cache : non pris en charge', de: 'Gecachte Kacheln: nicht unterstützt', es: 'Teselas en caché: no compatible', it: 'Tile in cache: non supportato' },
  '快取瓦片：0 個': { en: 'Cached tiles: 0', ja: 'キャッシュタイル：0', ko: '캐시 타일: 0개', fr: 'Tuiles en cache : 0', de: 'Gecachte Kacheln: 0', es: 'Teselas en caché: 0', it: 'Tile in cache: 0' },
  '查無結果': { en: 'No results', ja: '結果がありません', ko: '결과 없음', fr: 'Aucun résultat', de: 'Keine Ergebnisse', es: 'Sin resultados', it: 'Nessun risultato' },
  '搜尋中…': { en: 'Searching…', ja: '検索中…', ko: '검색 중…', fr: 'Recherche…', de: 'Suche…', es: 'Buscando…', it: 'Ricerca…' },
  '搜尋失敗,請稍後再試': { en: 'Search failed. Please try again later.', ja: '検索に失敗しました。後でもう一度お試しください。', ko: '검색에 실패했습니다. 잠시 후 다시 시도하세요.', fr: 'La recherche a échoué. Réessayez plus tard.', de: 'Suche fehlgeschlagen. Bitte später erneut versuchen.', es: 'La búsqueda falló. Inténtalo más tarde.', it: 'Ricerca non riuscita. Riprova più tardi.' },
  '+ 航點': { en: '+ Waypoint', ja: '+ ウェイポイント', ko: '+ 웨이포인트', fr: '+ Waypoint', de: '+ Wegpunkt', es: '+ Waypoint', it: '+ Waypoint' },
  '加入為航點': { en: 'Add as waypoint', ja: 'ウェイポイントとして追加', ko: '웨이포인트로 추가', fr: 'Ajouter comme waypoint', de: 'Als Wegpunkt hinzufügen', es: 'Añadir como waypoint', it: 'Aggiungi come waypoint' },
  '起點': { en: 'Start', ja: '開始点', ko: '출발점', fr: 'Départ', de: 'Start', es: 'Inicio', it: 'Partenza' },
  '終點': { en: 'Finish', ja: '終点', ko: '도착점', fr: 'Arrivée', de: 'Ziel', es: 'Final', it: 'Arrivo' },
  '中點': { en: 'Midpoint', ja: '中間点', ko: '중간점', fr: 'Milieu', de: 'Mitte', es: 'Punto medio', it: 'Punto medio' },
  '回程': { en: 'Return', ja: '復路', ko: '돌아가는 길', fr: 'Retour', de: 'Rückweg', es: 'Regreso', it: 'Ritorno' },
  '未命名路線': { en: 'Untitled route', ja: '無題のルート', ko: '이름 없는 루트', fr: 'Itinéraire sans nom', de: 'Unbenannte Route', es: 'Ruta sin título', it: 'Percorso senza nome' },
  '路線': { en: 'Route', ja: 'ルート', ko: '루트', fr: 'Itinéraire', de: 'Route', es: 'Ruta', it: 'Percorso' },
  '最佳': { en: 'Best', ja: '最適', ko: '최적', fr: 'Meilleur', de: 'Beste', es: 'Mejor', it: 'Migliore' },
  '溫度': { en: 'Temperature', ja: '気温', ko: '기온', fr: 'Température', de: 'Temperatur', es: 'Temperatura', it: 'Temperatura' },
  '雨量': { en: 'Rainfall', ja: '雨量', ko: '강수량', fr: 'Pluie', de: 'Niederschlag', es: 'Lluvia', it: 'Pioggia' },
  '降雨機率': { en: 'Rain chance', ja: '降水確率', ko: '강수 확률', fr: 'Probabilité de pluie', de: 'Regenwahrscheinlichkeit', es: 'Probabilidad de lluvia', it: 'Probabilità pioggia' },
  '最高溫': { en: 'High temp', ja: '最高気温', ko: '최고 기온', fr: 'Temp. max', de: 'Höchsttemp.', es: 'Temp. máx.', it: 'Temp. max' },
  '最低溫': { en: 'Low temp', ja: '最低気温', ko: '최저 기온', fr: 'Temp. min', de: 'Tiefsttemp.', es: 'Temp. mín.', it: 'Temp. min' },
  '體感溫度': { en: 'Feels like', ja: '体感温度', ko: '체감 온도', fr: 'Ressenti', de: 'Gefühlt', es: 'Sensación térmica', it: 'Percepita' },
  '濕度': { en: 'Humidity', ja: '湿度', ko: '습도', fr: 'Humidité', de: 'Luftfeuchte', es: 'Humedad', it: 'Umidità' },
  '露點': { en: 'Dew point', ja: '露点', ko: '이슬점', fr: 'Point de rosée', de: 'Taupunkt', es: 'Punto de rocío', it: 'Punto di rugiada' },
  '雲量': { en: 'Cloud cover', ja: '雲量', ko: '운량', fr: 'Nébulosité', de: 'Bewölkung', es: 'Nubosidad', it: 'Copertura nuvolosa' },
  '風速': { en: 'Wind speed', ja: '風速', ko: '풍속', fr: 'Vent', de: 'Wind', es: 'Viento', it: 'Vento' },
  '陣風': { en: 'Gusts', ja: '突風', ko: '돌풍', fr: 'Rafales', de: 'Böen', es: 'Rachas', it: 'Raffiche' },
  '能見度': { en: 'Visibility', ja: '視程', ko: '가시거리', fr: 'Visibilité', de: 'Sichtweite', es: 'Visibilidad', it: 'Visibilità' },
  '日照': { en: 'Sunshine', ja: '日照', ko: '일조', fr: 'Ensoleillement', de: 'Sonnenschein', es: 'Sol', it: 'Soleggiamento' },
  '輻射': { en: 'Radiation', ja: '日射量', ko: '복사량', fr: 'Rayonnement', de: 'Strahlung', es: 'Radiación', it: 'Radiazione' },
  '日出': { en: 'Sunrise', ja: '日の出', ko: '일출', fr: 'Lever du soleil', de: 'Sonnenaufgang', es: 'Amanecer', it: 'Alba' },
  '日落': { en: 'Sunset', ja: '日の入り', ko: '일몰', fr: 'Coucher du soleil', de: 'Sonnenuntergang', es: 'Atardecer', it: 'Tramonto' },
  '海拔': { en: 'Elevation', ja: '標高', ko: '고도', fr: 'Altitude', de: 'Höhe', es: 'Altitud', it: 'Quota' },
  '已復原': { en: 'Undone', ja: '元に戻しました', ko: '실행 취소됨', fr: 'Annulé', de: 'Rückgängig gemacht', es: 'Deshecho', it: 'Annullato' },
  '已取消復原': { en: 'Redone', ja: 'やり直しました', ko: '다시 실행됨', fr: 'Rétabli', de: 'Wiederhergestellt', es: 'Rehecho', it: 'Ripetuto' },
  '已設為航點': { en: 'Set as waypoint', ja: 'ウェイポイントに設定しました', ko: '웨이포인트로 설정됨', fr: 'Défini comme waypoint', de: 'Als Wegpunkt gesetzt', es: 'Definido como waypoint', it: 'Impostato come waypoint' },
  '複製失敗': { en: 'Copy failed', ja: 'コピーに失敗しました', ko: '복사 실패', fr: 'Échec de la copie', de: 'Kopieren fehlgeschlagen', es: 'Error al copiar', it: 'Copia non riuscita' },
  '已清除 GPS 游標': { en: 'GPS cursor cleared', ja: 'GPSカーソルを消去しました', ko: 'GPS 커서 지움', fr: 'Curseur GPS effacé', de: 'GPS-Cursor gelöscht', es: 'Cursor GPS borrado', it: 'Cursore GPS cancellato' },
  '請選擇 GPX 或 KML 軌跡': { en: 'Choose GPX or KML tracks', ja: 'GPXまたはKML軌跡を選択してください', ko: 'GPX 또는 KML 트랙을 선택하세요', fr: 'Choisissez des traces GPX ou KML', de: 'GPX- oder KML-Tracks wählen', es: 'Elige tracks GPX o KML', it: 'Scegli tracce GPX o KML' },
  '最多只能保留 5 條校正軌跡': { en: 'You can keep up to 5 calibration tracks', ja: '補正軌跡は最大5本までです', ko: '보정 트랙은 최대 5개까지 보관할 수 있습니다', fr: 'Vous pouvez conserver jusqu’à 5 traces de calibration', de: 'Bis zu 5 Kalibrier-Tracks möglich', es: 'Puedes conservar hasta 5 tracks de calibración', it: 'Puoi conservare fino a 5 tracce di calibrazione' },
  '已達 5 條上限，只載入前幾條軌跡': { en: 'Limit is 5 tracks; only the first tracks were loaded', ja: '上限は5本です。先頭の軌跡のみ読み込みました', ko: '최대 5개까지 가능하여 앞의 트랙만 불러왔습니다', fr: 'Limite de 5 traces ; seules les premières ont été chargées', de: 'Limit 5 Tracks; nur die ersten wurden geladen', es: 'Límite de 5 tracks; solo se cargaron los primeros', it: 'Limite di 5 tracce; caricate solo le prime' },
  '請先為至少一條校正軌跡輸入實際耗時': { en: 'Enter actual time for at least one calibration track', ja: '少なくとも1本の補正軌跡に実際の所要時間を入力してください', ko: '보정 트랙 하나 이상에 실제 소요 시간을 입력하세요', fr: 'Saisissez le temps réel pour au moins une trace', de: 'Für mindestens einen Kalibrier-Track die tatsächliche Zeit eingeben', es: 'Introduce el tiempo real de al menos un track de calibración', it: 'Inserisci il tempo reale per almeno una traccia di calibrazione' },
  '未選取任何操作目標 (標示點 / 中繼點)': { en: 'No targets selected (marked / intermediate points)', ja: '対象が選択されていません（マーク点 / 中間点）', ko: '선택된 대상이 없습니다 (표시 지점 / 중간 지점)', fr: 'Aucune cible sélectionnée (points marqués / intermédiaires)', de: 'Keine Ziele ausgewählt (markierte / Zwischenpunkte)', es: 'No hay objetivos seleccionados (marcados / intermedios)', it: 'Nessun obiettivo selezionato (marcati / intermedi)' },
  '未選取任何操作目標': { en: 'No targets selected', ja: '対象が選択されていません', ko: '선택된 대상이 없습니다', fr: 'Aucune cible sélectionnée', de: 'Keine Ziele ausgewählt', es: 'No hay objetivos seleccionados', it: 'Nessun obiettivo selezionato' },
  '正在定位...': { en: 'Locating...', ja: '現在地を取得中...', ko: '위치 확인 중...', fr: 'Localisation...', de: 'Standort wird ermittelt...', es: 'Localizando...', it: 'Localizzazione...' },
  '重新規劃路線中…': { en: 'Replanning route…', ja: 'ルートを再計算中…', ko: '루트 다시 계획 중…', fr: 'Replanification de l’itinéraire…', de: 'Route wird neu geplant…', es: 'Replanificando ruta…', it: 'Ricalcolo percorso…' },
  '請至少勾選一項離線地圖包內容': { en: 'Select at least one map pack item', ja: '地図パック内容を少なくとも1つ選択してください', ko: '지도 팩 항목을 하나 이상 선택하세요', fr: 'Sélectionnez au moins un élément du pack', de: 'Mindestens einen Kartenpaket-Inhalt wählen', es: 'Selecciona al menos un elemento del paquete', it: 'Seleziona almeno un elemento del pacchetto' },
  '至少需勾選一項': { en: 'Select at least one item', ja: '少なくとも1つ選択してください', ko: '하나 이상 선택하세요', fr: 'Sélectionnez au moins un élément', de: 'Mindestens ein Element wählen', es: 'Selecciona al menos un elemento', it: 'Seleziona almeno un elemento' },
  '匯出失敗': { en: 'Export failed', ja: '書き出しに失敗しました', ko: '내보내기 실패', fr: 'Échec de l’export', de: 'Export fehlgeschlagen', es: 'Error al exportar', it: 'Esportazione non riuscita' },
  '檔案解析失敗': { en: 'File parsing failed', ja: 'ファイル解析に失敗しました', ko: '파일 파싱 실패', fr: 'Échec de l’analyse du fichier', de: 'Datei konnte nicht gelesen werden', es: 'Error al analizar el archivo', it: 'Analisi file non riuscita' },
  '路線還原失敗': { en: 'Route restore failed', ja: 'ルート復元に失敗しました', ko: '루트 복원 실패', fr: 'Échec de la restauration', de: 'Route konnte nicht wiederhergestellt werden', es: 'Error al restaurar la ruta', it: 'Ripristino percorso non riuscito' },
  '匯入失敗': { en: 'Import failed', ja: 'インポートに失敗しました', ko: '가져오기 실패', fr: 'Échec de l’import', de: 'Import fehlgeschlagen', es: 'Error al importar', it: 'Importazione non riuscita' },
  '匯出路線/圖磚前請先建立路線': { en: 'Create a route before exporting route data or tiles', ja: 'ルートやタイルを書き出す前にルートを作成してください', ko: '루트/타일을 내보내기 전에 먼저 루트를 만드세요', fr: 'Créez un itinéraire avant d’exporter la route ou les tuiles', de: 'Vor dem Export von Route/Kacheln zuerst eine Route erstellen', es: 'Crea una ruta antes de exportar ruta o teselas', it: 'Crea un percorso prima di esportare percorso o tile' },
  '最愛資料無效': { en: 'Favorite data is invalid', ja: 'お気に入りデータが無効です', ko: '즐겨찾기 데이터가 유효하지 않습니다', fr: 'Favori invalide', de: 'Favoritendaten ungültig', es: 'Datos de favorito no válidos', it: 'Dati preferito non validi' },
  '已刪除': { en: 'Deleted', ja: '削除しました', ko: '삭제됨', fr: 'Supprimé', de: 'Gelöscht', es: 'Eliminado', it: 'Eliminato' },
  '至少需 2 個航點才能加入最愛': { en: 'At least 2 waypoints are required to add a favorite', ja: 'お気に入りに追加するには少なくとも2つのウェイポイントが必要です', ko: '즐겨찾기에 추가하려면 웨이포인트가 최소 2개 필요합니다', fr: 'Au moins 2 waypoints sont nécessaires pour ajouter un favori', de: 'Mindestens 2 Wegpunkte zum Favorisieren erforderlich', es: 'Se necesitan al menos 2 waypoints para añadir a favoritos', it: 'Servono almeno 2 waypoint per aggiungere ai preferiti' },
  '已加入我的最愛': { en: 'Added to favorites', ja: 'お気に入りに追加しました', ko: '즐겨찾기에 추가됨', fr: 'Ajouté aux favoris', de: 'Zu Favoriten hinzugefügt', es: 'Añadido a favoritos', it: 'Aggiunto ai preferiti' },
  '已取代最愛': { en: 'Favorite replaced', ja: 'お気に入りを置き換えました', ko: '즐겨찾기 교체됨', fr: 'Favori remplacé', de: 'Favorit ersetzt', es: 'Favorito reemplazado', it: 'Preferito sostituito' },
  '不支援的檔案格式': { en: 'Unsupported file format', ja: '未対応のファイル形式', ko: '지원되지 않는 파일 형식', fr: 'Format de fichier non pris en charge', de: 'Nicht unterstütztes Dateiformat', es: 'Formato de archivo no compatible', it: 'Formato file non supportato' },
  '已清除個人配速校正': { en: 'Personal pace calibration cleared', ja: '個人ペース補正を消去しました', ko: '개인 페이스 보정을 지웠습니다', fr: 'Calibration personnelle effacée', de: 'Persönliche Tempo-Kalibrierung gelöscht', es: 'Calibración personal borrada', it: 'Calibrazione personale cancellata' },
  '請先建立路線': { en: 'Create a route first', ja: '先にルートを作成してください', ko: '먼저 루트를 만드세요', fr: 'Créez d’abord un itinéraire', de: 'Erstellen Sie zuerst eine Route', es: 'Crea primero una ruta', it: 'Crea prima un percorso' },
  '路線已清除': { en: 'Route cleared', ja: 'ルートを消去しました', ko: '루트가 지워졌습니다', fr: 'Itinéraire effacé', de: 'Route gelöscht', es: 'Ruta borrada', it: 'Percorso cancellato' },
  '規劃最佳路徑中...': { en: 'Planning best route...', ja: '最適ルートを計画中...', ko: '최적 루트 계획 중...', fr: 'Planification du meilleur itinéraire...', de: 'Beste Route wird geplant...', es: 'Planificando mejor ruta...', it: 'Pianificazione percorso migliore...' },
  '找不到合適路徑': { en: 'No suitable route found', ja: '適切なルートが見つかりません', ko: '적합한 루트를 찾을 수 없습니다', fr: 'Aucun itinéraire adapté', de: 'Keine passende Route gefunden', es: 'No se encontró una ruta adecuada', it: 'Nessun percorso adatto trovato' },
  '路徑計算失敗': { en: 'Route calculation failed', ja: 'ルート計算に失敗しました', ko: '루트 계산 실패', fr: 'Échec du calcul d’itinéraire', de: 'Routenberechnung fehlgeschlagen', es: 'Error al calcular la ruta', it: 'Calcolo percorso non riuscito' },
  '天氣資訊已更新': { en: 'Weather updated', ja: '天気情報を更新しました', ko: '날씨 정보 업데이트됨', fr: 'Météo mise à jour', de: 'Wetter aktualisiert', es: 'Tiempo actualizado', it: 'Meteo aggiornato' },
  '已加入航點': { en: 'Waypoint added', ja: 'ウェイポイントを追加しました', ko: '웨이포인트 추가됨', fr: 'Waypoint ajouté', de: 'Wegpunkt hinzugefügt', es: 'Waypoint añadido', it: 'Waypoint aggiunto' },
  '座標格式錯誤,請輸入「緯度, 經度」': { en: 'Invalid coordinates. Enter “latitude, longitude”.', ja: '座標形式が正しくありません。「緯度, 経度」を入力してください。', ko: '좌표 형식이 잘못되었습니다. “위도, 경도”를 입력하세요.', fr: 'Coordonnées invalides. Saisissez « latitude, longitude ».', de: 'Ungültige Koordinaten. „Breite, Länge“ eingeben.', es: 'Coordenadas no válidas. Introduce “latitud, longitud”.', it: 'Coordinate non valide. Inserisci “latitudine, longitudine”.' },
  '語言': { en: 'Language', ja: '言語', ko: '언어', fr: 'Langue', de: 'Sprache', es: 'Idioma', it: 'Lingua' },
};

const WMO_DESC = {
  0: { 'zh-TW': '晴天', en: 'Clear sky', ja: '快晴', ko: '맑음', fr: 'Ciel dégagé', de: 'Klarer Himmel', es: 'Cielo despejado', it: 'Cielo sereno' },
  1: { 'zh-TW': '大致晴朗', en: 'Mostly clear', ja: 'おおむね晴れ', ko: '대체로 맑음', fr: 'Plutôt dégagé', de: 'Überwiegend klar', es: 'Mayormente despejado', it: 'Prevalentemente sereno' },
  2: { 'zh-TW': '多雲', en: 'Partly cloudy', ja: '一部曇り', ko: '부분적으로 흐림', fr: 'Partiellement nuageux', de: 'Teilweise bewölkt', es: 'Parcialmente nuboso', it: 'Parzialmente nuvoloso' },
  3: { 'zh-TW': '陰天', en: 'Overcast', ja: '曇り', ko: '흐림', fr: 'Couvert', de: 'Bedeckt', es: 'Cubierto', it: 'Coperto' },
  45: { 'zh-TW': '霧', en: 'Fog', ja: '霧', ko: '안개', fr: 'Brouillard', de: 'Nebel', es: 'Niebla', it: 'Nebbia' },
  48: { 'zh-TW': '霜霧', en: 'Rime fog', ja: '着氷性霧', ko: '상고대 안개', fr: 'Brouillard givrant', de: 'Raureifnebel', es: 'Niebla con escarcha', it: 'Nebbia con brina' },
  51: { 'zh-TW': '小毛雨', en: 'Light drizzle', ja: '弱い霧雨', ko: '약한 이슬비', fr: 'Bruine faible', de: 'Leichter Nieselregen', es: 'Llovizna débil', it: 'Pioviggine debole' },
  53: { 'zh-TW': '毛雨', en: 'Drizzle', ja: '霧雨', ko: '이슬비', fr: 'Bruine', de: 'Nieselregen', es: 'Llovizna', it: 'Pioviggine' },
  55: { 'zh-TW': '大毛雨', en: 'Heavy drizzle', ja: '強い霧雨', ko: '강한 이슬비', fr: 'Bruine forte', de: 'Starker Nieselregen', es: 'Llovizna intensa', it: 'Pioviggine forte' },
  61: { 'zh-TW': '小雨', en: 'Light rain', ja: '小雨', ko: '약한 비', fr: 'Pluie faible', de: 'Leichter Regen', es: 'Lluvia débil', it: 'Pioggia debole' },
  63: { 'zh-TW': '中雨', en: 'Moderate rain', ja: '雨', ko: '보통 비', fr: 'Pluie modérée', de: 'Mäßiger Regen', es: 'Lluvia moderada', it: 'Pioggia moderata' },
  65: { 'zh-TW': '大雨', en: 'Heavy rain', ja: '強い雨', ko: '강한 비', fr: 'Forte pluie', de: 'Starker Regen', es: 'Lluvia intensa', it: 'Pioggia forte' },
  71: { 'zh-TW': '小雪', en: 'Light snow', ja: '小雪', ko: '약한 눈', fr: 'Neige faible', de: 'Leichter Schnee', es: 'Nieve débil', it: 'Neve debole' },
  73: { 'zh-TW': '中雪', en: 'Moderate snow', ja: '雪', ko: '보통 눈', fr: 'Neige modérée', de: 'Mäßiger Schnee', es: 'Nieve moderada', it: 'Neve moderata' },
  75: { 'zh-TW': '大雪', en: 'Heavy snow', ja: '大雪', ko: '폭설', fr: 'Forte neige', de: 'Starker Schnee', es: 'Nieve intensa', it: 'Neve forte' },
  80: { 'zh-TW': '陣雨', en: 'Rain showers', ja: 'にわか雨', ko: '소나기', fr: 'Averses', de: 'Regenschauer', es: 'Chubascos', it: 'Rovesci' },
  81: { 'zh-TW': '中陣雨', en: 'Moderate showers', ja: 'やや強いにわか雨', ko: '보통 소나기', fr: 'Averses modérées', de: 'Mäßige Schauer', es: 'Chubascos moderados', it: 'Rovesci moderati' },
  82: { 'zh-TW': '大陣雨', en: 'Heavy showers', ja: '強いにわか雨', ko: '강한 소나기', fr: 'Fortes averses', de: 'Starke Schauer', es: 'Chubascos intensos', it: 'Rovesci forti' },
  95: { 'zh-TW': '雷暴', en: 'Thunderstorm', ja: '雷雨', ko: '뇌우', fr: 'Orage', de: 'Gewitter', es: 'Tormenta', it: 'Temporale' },
  96: { 'zh-TW': '雷暴伴冰雹', en: 'Thunderstorm with hail', ja: 'ひょうを伴う雷雨', ko: '우박 동반 뇌우', fr: 'Orage avec grêle', de: 'Gewitter mit Hagel', es: 'Tormenta con granizo', it: 'Temporale con grandine' },
  99: { 'zh-TW': '強雷暴伴冰雹', en: 'Severe thunderstorm with hail', ja: '激しいひょう雷雨', ko: '강한 우박 동반 뇌우', fr: 'Orage violent avec grêle', de: 'Schweres Gewitter mit Hagel', es: 'Tormenta fuerte con granizo', it: 'Temporale forte con grandine' },
  unknown: { 'zh-TW': '未知', en: 'Unknown', ja: '不明', ko: '알 수 없음', fr: 'Inconnu', de: 'Unbekannt', es: 'Desconocido', it: 'Sconosciuto' },
  unavailable: { 'zh-TW': '無法取得', en: 'Unavailable', ja: '取得不可', ko: '가져올 수 없음', fr: 'Indisponible', de: 'Nicht verfügbar', es: 'No disponible', it: 'Non disponibile' },
};

let currentLanguage = detectLanguage();
const textOriginals = new WeakMap();
let observer = null;
let onLanguageChange = null;
let translationLanguageOverride = null;
const pendingTranslationRoots = new Set();
let pendingTranslationFrame = 0;

function scheduleTranslateTree(root) {
  if (!root) return;
  pendingTranslationRoots.add(root);
  if (pendingTranslationFrame) return;
  const schedule = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : (cb) => setTimeout(cb, 0);
  pendingTranslationFrame = schedule(() => {
    pendingTranslationFrame = 0;
    const roots = Array.from(pendingTranslationRoots);
    pendingTranslationRoots.clear();
    roots.forEach(translateTree);
  });
}

export function detectLanguage() {
  const saved = localStorage.getItem(LS_LANGUAGE_KEY);
  if (saved && SUPPORTED.has(saved)) return saved;
  const navLangs = navigator.languages?.length ? navigator.languages : [navigator.language || 'zh-TW'];
  for (const raw of navLangs) {
    const lang = String(raw || '').toLowerCase();
    if (lang.startsWith('zh')) return 'zh-TW';
    const base = lang.split('-')[0];
    if (SUPPORTED.has(base)) return base;
  }
  return 'zh-TW';
}

export function getLanguage() {
  return currentLanguage;
}

export function setLanguage(lang) {
  currentLanguage = SUPPORTED.has(lang) ? lang : 'zh-TW';
  localStorage.setItem(LS_LANGUAGE_KEY, currentLanguage);
  applyTranslations();
  onLanguageChange?.(currentLanguage);
}

export function t(key, params = {}) {
  const entry = STRINGS[key] || PHRASES[key];
  const fallback = entry?.['zh-TW'] ?? key;
  let value = entry?.[currentLanguage] ?? fallback;
  if (value == null) value = fallback;
  return interpolate(value, params);
}

export function tWmo(code, kind = 'desc') {
  if (kind !== 'desc') return '';
  const entry = WMO_DESC[code] || WMO_DESC.unknown;
  return entry[currentLanguage] || entry['zh-TW'];
}

export function translateWeatherText(value) {
  if (value == null) return value;
  const raw = String(value);
  const match = raw.match(/^(\S+)(?:\s+(.+))?$/);
  if (!match) return raw;
  const icon = match[1] || '';
  const desc = (match[2] || '').trim();
  if (!desc || desc === '—') return translateWmoDescription(raw) || raw;
  const translated = translateWmoDescription(desc);
  return translated ? `${icon} ${translated}`.trim() : raw;
}

function translateWmoDescription(desc) {
  const normalized = String(desc || '').trim();
  if (!normalized) return '';
  for (const entry of Object.values(WMO_DESC)) {
    if (Object.values(entry).includes(normalized)) {
      return entry[currentLanguage] || entry['zh-TW'] || normalized;
    }
  }
  return translatePhrase(normalized);
}

export function translatePhrase(text) {
  return translatePhraseForLanguage(text, currentLanguage);
}

function translatePhraseForLanguage(text, language) {
  if (text == null) return text;
  const raw = String(text);
  const trimmed = raw.replace(/\s+/g, ' ').trim();
  if (!trimmed) return raw;
  const direct = PHRASES[trimmed] || STRINGS[trimmed];
  if (direct) return preserveOuterWhitespace(raw, direct[language] ?? direct['zh-TW'] ?? trimmed);

  const previousOverride = translationLanguageOverride;
  translationLanguageOverride = language;
  try {
    const pattern = translatePattern(trimmed);
    return pattern ? preserveOuterWhitespace(raw, pattern) : raw;
  } finally {
    translationLanguageOverride = previousOverride;
  }
}

export function applyTranslations(root = document) {
  document.documentElement.lang = currentLanguage;
  document.title = t('Mapping Elf — GPX 軌跡生成器');
  const meta = document.querySelector('meta[name="description"]');
  if (meta) meta.content = t('app.description');
  translateTree(root);
  updateLanguageSelect();
  updateQuoteVisibility();
  renderInstructionsContent();
}

export function initI18n(options = {}) {
  onLanguageChange = options.onLanguageChange || null;
  installLanguageSelect();
  applyTranslations();
  if (!observer && document.body) {
    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE) scheduleTranslateTree(node);
        });
        if (mutation.type === 'characterData') scheduleTranslateTree(mutation.target);
        if (mutation.type === 'attributes') translateElementAttributes(mutation.target);
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['title', 'placeholder', 'aria-label', 'alt'],
    });
  }
}

function installLanguageSelect() {
  if (document.getElementById('language-select')) return;
  const toolbarRight = document.querySelector('.toolbar-right');
  if (!toolbarRight) return;
  const label = document.createElement('label');
  label.className = 'language-switcher';
  label.title = t('語言');
  label.innerHTML = `<span class="language-switcher-icon" aria-hidden="true">文</span><select id="language-select" aria-label="${t('語言')}"></select>`;
  const select = label.querySelector('select');
  LANGUAGES.forEach(({ code, label }) => {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = label;
    select.appendChild(opt);
  });
  select.value = currentLanguage;
  select.addEventListener('change', () => setLanguage(select.value));
  toolbarRight.prepend(label);
}

function updateLanguageSelect() {
  const select = document.getElementById('language-select');
  if (select) select.value = currentLanguage;
  const label = document.querySelector('.language-switcher');
  if (label) label.title = t('語言');
  if (select) select.setAttribute('aria-label', t('語言'));
}

function updateQuoteVisibility() {
  const quote = document.querySelector('.quote-zh');
  if (!quote) return;
  quote.hidden = currentLanguage === 'en';
}

function renderInstructionsContent() {
  const content = document.querySelector('.instructions-content');
  if (!content) return;
  const html = [
    instructionRow([
      instructionGroup('📱', '手機版天氣卡', [
        badgeLine('上滑', '切換 詳細/簡要 模式'),
        badgeLine('下滑', '關閉天氣卡'),
        badgeLine('左右輕掃', '切換點位'),
        plainLine('標籤與卡片均支援集體連動'),
      ]),
      instructionGroup('💻', '電腦版快捷鍵', [
        `<li><span class="instr-badge">↑</span> / <span class="instr-badge">↓</span>: ${instructionText('展開/縮放或關閉卡片')}</li>`,
        `<li><span class="instr-badge">←</span> / <span class="instr-badge">→</span>: ${instructionText('左右切換點位')}</li>`,
        `<li><span class="instr-badge">Ctrl+Z</span>: ${instructionText('復原')} / <span class="instr-badge">Ctrl+Shift+Z</span>: ${instructionText('重做')}</li>`,
        `<li><span class="instr-badge">Esc</span>: ${instructionText('關閉搜尋結果或選單')}</li>`,
      ]),
    ]),
    instructionRow([
      instructionGroup('📍', 'GPS 游標與定位', [
        `<li>${instructionText('點擊右側')} ${instructionKey('定位按鈕')} ${instructionText('放置游標')}</li>`,
        `<li>${instructionText('點擊/長按游標可')} ${instructionKey('設為航點')} ${instructionText('或查詢天氣')}</li>`,
      ]),
      instructionGroup('⭐', '我的最愛與匯出', [
        `<li>${instructionText('點擊')} ${instructionKey('星號')} ${instructionText('儲存路線，上限 10 筆')}</li>`,
        plainLine('支援匯出 GPX、KML 與離線地圖包'),
      ]),
    ]),
    instructionRow([
      instructionGroup('🧭', '路線規劃說明', [
        plainLine('依序點選地圖即可建立航點；拖曳航點可微調路線位置'),
        `<li><span class="instr-badge">${t('單程')}</span> ${instructionText('適合 A 到 B；')} <span class="instr-badge">${t('來回')}</span> ${instructionText('會自動折返；')} <span class="instr-badge">${t('O繞')}</span> ${instructionText('會尋找回到起點的替代路線')}</li>`,
        plainLine('若出現多條候選路線，可點選候選卡或地圖上的軌跡切換主路線'),
      ]),
      instructionGroup('🌦', '天氣資料說明', [
        plainLine('短期預報優先參考 Open-Meteo；需要比對模式時可切換 Windy 模型'),
        plainLine('天氣卡顯示的是航點附近資料，山區微地形與稜線風仍需現地判斷'),
        plainLine('出發前建議重整資料，並留意降雨、體感溫度、陣風與雷雨指標'),
      ]),
    ]),
    instructionRow([
      instructionGroup('🧮', '估時小提醒', [
        plainLine('配速估算會受到坡度、距離、負重、休息與疲勞設定影響'),
        plainLine('匯入自己的 GPX/KML 並填入實際耗時，可建立更貼近個人體感的校正倍率'),
        plainLine('估時適合做行程規劃基準；困難地形、摸黑、濕滑路況請預留額外時間'),
      ]),
      instructionGroup('🗺', '離線地圖包提醒', [
        plainLine('.melmap 可保存路線、航點、目前圖層圖磚與部分個人偏好'),
        plainLine('離線圖磚只會包含匯出當下選取的範圍與縮放層級'),
        plainLine('地圖包可能較大；出發前請先匯入測試，確認路線與圖層都能正常開啟'),
      ]),
    ]),
    `<div class="instr-group" style="margin-bottom: 16px;">
      ${instructionTitle('💡', '使用者小提示')}
      <ul class="instr-list" style="margin: 0; padding-left: 18px; line-height: 1.6;">
        ${tipLine('快速複製', '點擊任何座標、GPS 游標或天氣卡中的經緯度，即可複製到剪貼簿')}
        ${tipLine('收起也能找點', '側欄收起時，點頂部標題仍可搜尋地點、切換運動或天氣模式')}
        ${tipLine('同步查看高度', '拖曳高度圖游標可同步高亮地圖位置；雙擊高度圖可快速收放面板')}
        <li>${instructionLabel('快速編輯航點')}: ${instructionText('雙擊側欄或表頭的')} ${instructionKey('名稱')} ${instructionText('可改名；長按或右鍵地圖航點可拖曳微調')}</li>
        ${tipLine('重疊層級切換', '重疊軌跡可雙擊軌跡輪換上下層；重疊航點可雙擊航點切換顯示層級，已選取時再點一次也會輪換；長按或右鍵航點只會拖曳微調')}
        ${tipLine('天氣卡操作', '大格可點天氣圖示或下滑關閉、點空白處縮小，且只操作目前卡片；小格可點資訊展開、點圖示關閉，會依集體設定連動；再次開啟會記住大格或小格')}
        ${tipLine('批次天氣卡', '在「航點設置」勾選連動對象後，收合、展開或關閉會套用到整組天氣卡')}
        ${tipLine('拖曳刪除與取消', '地圖航點、側欄與表格項目拖曳時會出現取消與移除區；拖到移除區刪除，拖到取消區取消本次拖曳；最愛項目拖出框外刪除，放回框內取消')}
      </ul>
    </div>`,
  ].join('');
  if (content.dataset.renderedLang === currentLanguage && content.innerHTML === html) return;
  content.dataset.renderedLang = currentLanguage;
  content.innerHTML = html;
}

function instructionRow(groups) {
  return `<div class="instr-row" style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px;">${groups.join('')}</div>`;
}

function instructionGroup(icon, title, lines) {
  return `<div class="instr-group">${instructionTitle(icon, title)}<ul class="instr-list" style="margin: 0; padding-left: 18px; line-height: 1.6;">${lines.join('')}</ul></div>`;
}

function instructionTitle(icon, title) {
  return `<div class="instr-title" style="font-weight: bold; color: var(--text-primary); margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">${icon} ${t(title)}</div>`;
}

function badgeLine(badge, text) {
  return `<li><span class="instr-badge">${t(badge)}</span>: ${instructionText(text)}</li>`;
}

function plainLine(text) {
  return `<li>${instructionText(text)}</li>`;
}

function tipLine(label, text) {
  return `<li>${instructionLabel(label)}: ${instructionText(text)}</li>`;
}

function instructionText(key) {
  return highlightInstructionText(t(key));
}

function instructionLabel(key) {
  return `<span class="instr-label">${escapeHtml(t(key))}</span>`;
}

function instructionKey(key) {
  return `<span class="instr-key">${escapeHtml(t(key))}</span>`;
}

const INSTRUCTION_HIGHLIGHT_KEYS = [
  '切換 詳細/簡要 模式',
  '關閉天氣卡',
  '切換點位',
  '集體連動',
  '展開',
  '關閉',
  '搜尋',
  '選單',
  '定位按鈕',
  '游標',
  '設為航點',
  '或查詢天氣',
  '星號',
  '匯入',
  '匯出',
  '路線',
  '航點',
  '軌跡',
  '天氣卡',
  '拖曳',
  '雙擊',
  '長按',
  '右鍵',
  '收合',
  '縮小',
  '候選路線',
  '候選卡',
  '主路線',
  '天氣',
  '降雨',
  '陣風',
  '雷暴',
  '配速',
  '距離',
  '負重',
  '休息間隔',
  '疲勞程度',
  '個人配速校正',
  '座標',
  '剪貼簿',
  '移除',
  '取消',
  '移除區',
  '取消區',
  '集體連動',
];

const INSTRUCTION_SHARED_HIGHLIGHTS = [
  'GPS',
  'GPX',
  'KML',
  'Open-Meteo',
  'Windy',
  '.melmap',
  'Ctrl+Z',
  'Ctrl+Shift+Z',
  'Esc',
  '16 天',
  '1940 年',
  '10 筆',
  '10 entries',
];

function highlightInstructionText(value) {
  const text = String(value ?? '');
  if (!text) return '';
  const terms = getInstructionHighlightTerms();
  if (!terms.length) return escapeHtml(text);
  const haystack = text.toLocaleLowerCase();
  const ranges = [];
  for (const term of terms) {
    const needle = term.toLocaleLowerCase();
    let index = haystack.indexOf(needle);
    while (index !== -1) {
      const end = index + term.length;
      if (!ranges.some(([start, stop]) => index < stop && end > start)) {
        ranges.push([index, end]);
      }
      index = haystack.indexOf(needle, index + Math.max(needle.length, 1));
    }
  }
  if (!ranges.length) return escapeHtml(text);
  ranges.sort((a, b) => a[0] - b[0]);
  let html = '';
  let cursor = 0;
  for (const [start, end] of ranges) {
    html += escapeHtml(text.slice(cursor, start));
    html += `<span class="instr-key">${escapeHtml(text.slice(start, end))}</span>`;
    cursor = end;
  }
  html += escapeHtml(text.slice(cursor));
  return html;
}

function getInstructionHighlightTerms() {
  const localized = INSTRUCTION_HIGHLIGHT_KEYS
    .map(key => t(key))
    .concat(INSTRUCTION_SHARED_HIGHLIGHTS);
  return [...new Set(localized)]
    .map(term => String(term || '').trim())
    .filter(term => term.length >= 2)
    .sort((a, b) => b.length - a.length);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function translateTree(root) {
  if (!root) return;
  if (root.nodeType === Node.TEXT_NODE) {
    translateTextNode(root);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE && root !== document) return;
  const element = root.nodeType === Node.ELEMENT_NODE ? root : document.body;
  if (!element) return;
  translateElementAttributes(element);
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (['SCRIPT', 'STYLE', 'TEXTAREA'].includes(parent.tagName)) return NodeFilter.FILTER_REJECT;
      if (parent.closest('[data-i18n-skip]')) return NodeFilter.FILTER_REJECT;
      return /[\u4e00-\u9fff]/.test(node.nodeValue || '') || textOriginals.has(node)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_SKIP;
    },
  });
  let node;
  while ((node = walker.nextNode())) translateTextNode(node);
  element.querySelectorAll?.('[title], [placeholder], [aria-label], [alt]').forEach(translateElementAttributes);
}

function translateTextNode(node) {
  if (!textOriginals.has(node)) {
    textOriginals.set(node, node.nodeValue);
  } else {
    const previousOriginal = textOriginals.get(node);
    const currentValue = node.nodeValue || '';
    if (!isKnownTranslation(currentValue, previousOriginal) && /[\u4e00-\u9fff]/.test(currentValue)) {
      textOriginals.set(node, currentValue);
    }
  }
  const original = textOriginals.get(node);
  const translated = translatePhrase(original);
  if (node.nodeValue !== translated) node.nodeValue = translated;
}

function translateElementAttributes(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return;
  if (el.dataset.i18n) {
    const translated = t(el.dataset.i18n);
    if (el.textContent !== translated) el.textContent = translated;
  }
  if (el.dataset.i18nTitle) el.setAttribute('title', t(el.dataset.i18nTitle));
  if (el.dataset.i18nPlaceholder) el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder));
  if (el.dataset.i18nAriaLabel) el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel));
  if (el.dataset.i18nAlt) el.setAttribute('alt', t(el.dataset.i18nAlt));
  ['title', 'placeholder', 'aria-label', 'alt'].forEach(attr => {
    if (!el.hasAttribute(attr)) return;
    const key = `i18nOriginal${attr.replace(/-([a-z])/g, (_, c) => c.toUpperCase())}`;
    const currentValue = el.getAttribute(attr) || '';
    if (!el.dataset[key]) {
      el.dataset[key] = currentValue;
    } else {
      if (!isKnownTranslation(currentValue, el.dataset[key]) && /[\u4e00-\u9fff]/.test(currentValue)) {
        el.dataset[key] = currentValue;
      }
    }
    const translated = translatePhrase(el.dataset[key]);
    if (el.getAttribute(attr) !== translated) el.setAttribute(attr, translated);
  });
}

function isKnownTranslation(value, original) {
  const rendered = String(value ?? '');
  return LANGUAGES.some(({ code }) => translatePhraseForLanguage(original, code) === rendered);
}

function translatePattern(text) {
  let m = text.match(/^航點 (\d+)$/);
  if (m) return withNum('Waypoint {n}', 'ウェイポイント {n}', '웨이포인트 {n}', 'Waypoint {n}', 'Wegpunkt {n}', 'Waypoint {n}', 'Waypoint {n}', m[1]);
  m = text.match(/^中繼點(?:\s+(\d+))?$/);
  if (m) return withNum(m[1] ? 'Intermediate point {n}' : 'Intermediate point', m[1] ? '中間点 {n}' : '中間点', m[1] ? '중간 지점 {n}' : '중간 지점', m[1] ? 'Point intermédiaire {n}' : 'Point intermédiaire', m[1] ? 'Zwischenpunkt {n}' : 'Zwischenpunkt', m[1] ? 'Punto intermedio {n}' : 'Punto intermedio', m[1] ? 'Punto intermedio {n}' : 'Punto intermedio', m[1]);
  m = text.match(/^(\d+) 條方案$/);
  if (m) return withNum('{n} options', '{n}案', '{n}개 경로', '{n} options', '{n} Optionen', '{n} opciones', '{n} opzioni', m[1]);
  m = text.match(/^(\d+) 個航點$/);
  if (m) return withNum('{n} waypoints', '{n}ウェイポイント', '{n}개 웨이포인트', '{n} waypoints', '{n} Wegpunkte', '{n} waypoints', '{n} waypoint', m[1]);
  m = text.match(/^快取瓦片：(\d+) 個$/);
  if (m) return withNum('Cached tiles: {n}', 'キャッシュタイル：{n}', '캐시 타일: {n}개', 'Tuiles en cache : {n}', 'Gecachte Kacheln: {n}', 'Teselas en caché: {n}', 'Tile in cache: {n}', m[1]);
  m = text.match(/^已複製座標 (.+)$/);
  if (m) return phraseWithText('Copied coordinates {x}', '座標をコピーしました {x}', '좌표 복사됨 {x}', 'Coordonnées copiées {x}', 'Koordinaten kopiert {x}', 'Coordenadas copiadas {x}', 'Coordinate copiate {x}', m[1]);
  m = text.match(/^已載入 (\d+) 條校正軌跡$/);
  if (m) return withNum('Loaded {n} calibration tracks', '{n}本の補正軌跡を読み込みました', '{n}개 보정 트랙을 불러왔습니다', '{n} traces de calibration chargées', '{n} Kalibrier-Tracks geladen', '{n} tracks de calibración cargados', '{n} tracce di calibrazione caricate', m[1]);
  m = text.match(/^校正軌跡讀取失敗：(.+)$/);
  if (m) return phraseWithText('Failed to read calibration track: {x}', '補正軌跡の読み込みに失敗：{x}', '보정 트랙 읽기 실패: {x}', 'Échec de lecture de la trace : {x}', 'Kalibrier-Track konnte nicht gelesen werden: {x}', 'Error al leer track de calibración: {x}', 'Lettura traccia di calibrazione non riuscita: {x}', m[1]);
  m = text.match(/^已關閉 (\d+) 個天氣卡$/);
  if (m) return withNum('Closed {n} weather cards', '{n}枚の天気カードを閉じました', '{n}개 날씨 카드를 닫았습니다', '{n} cartes météo fermées', '{n} Wetterkarten geschlossen', '{n} tarjetas del tiempo cerradas', '{n} schede meteo chiuse', m[1]);
  m = text.match(/^已切換 (\d+) 個天氣卡模式$/);
  if (m) return withNum('Toggled {n} weather cards', '{n}枚の天気カードを切り替えました', '{n}개 날씨 카드 모드를 전환했습니다', '{n} cartes météo changées', '{n} Wetterkarten umgeschaltet', '{n} tarjetas del tiempo cambiadas', '{n} schede meteo cambiate', m[1]);
  m = text.match(/^個人校正已更新：(.+)$/);
  if (m) return phraseWithText('Personal calibration updated: {x}', '個人補正を更新しました：{x}', '개인 보정 업데이트됨: {x}', 'Calibration personnelle mise à jour : {x}', 'Persönliche Kalibrierung aktualisiert: {x}', 'Calibración personal actualizada: {x}', 'Calibrazione personale aggiornata: {x}', m[1]);
  m = text.match(/^已依據「(.+)」重置配速時間$/);
  if (m) return phraseWithText('Pace times reset from “{x}”', '「{x}」を基準にペース時刻をリセットしました', '“{x}” 기준으로 페이스 시간을 재설정했습니다', 'Horaires d’allure réinitialisés depuis « {x} »', 'Tempozeiten ab „{x}“ zurückgesetzt', 'Tiempos de ritmo restablecidos desde “{x}”', 'Tempi di passo reimpostati da “{x}”', m[1]);
  m = text.match(/^已載入「(.+)」$/);
  if (m) return phraseWithText('Loaded “{x}”', '「{x}」を読み込みました', '“{x}” 불러옴', '« {x} » chargé', '„{x}“ geladen', '“{x}” cargado', '“{x}” caricato', m[1]);
  m = text.match(/^(.+) 檔案已匯出$/);
  if (m) return phraseWithText('{x} file exported', '{x}ファイルを書き出しました', '{x} 파일 내보냄', 'Fichier {x} exporté', '{x}-Datei exportiert', 'Archivo {x} exportado', 'File {x} esportato', m[1]);
  m = text.match(/^已匯入 (\d+) 個航點(.*)$/);
  if (m) return withNum('Imported {n} waypoints', '{n}ウェイポイントをインポートしました', '{n}개 웨이포인트 가져옴', '{n} waypoints importés', '{n} Wegpunkte importiert', '{n} waypoints importados', '{n} waypoint importati', m[1]);
  m = text.match(/^已匯入軌跡（(\d+) 個點(?:，(\d+) 個航點)?）$/);
  if (m) return withNum('Imported track ({n} points)', '軌跡をインポートしました（{n}点）', '트랙 가져옴 ({n}개 지점)', 'Trace importée ({n} points)', 'Track importiert ({n} Punkte)', 'Track importado ({n} puntos)', 'Traccia importata ({n} punti)', m[1]);
  return null;
}

function withNum(en, ja, ko, fr, de, es, it, n) {
  const entry = { 'zh-TW': null, en, ja, ko, fr, de, es, it };
  return (entry[translationLanguageOverride || currentLanguage] || '').replace('{n}', n ?? '');
}

function phraseWithText(en, ja, ko, fr, de, es, it, x) {
  const entry = { 'zh-TW': null, en, ja, ko, fr, de, es, it };
  return (entry[translationLanguageOverride || currentLanguage] || '').replace('{x}', x ?? '');
}

function preserveOuterWhitespace(original, translated) {
  const start = original.match(/^\s*/)?.[0] || '';
  const end = original.match(/\s*$/)?.[0] || '';
  return `${start}${translated}${end}`;
}

function interpolate(value, params) {
  return String(value).replace(/\{(\w+)\}/g, (_, key) => params[key] ?? '');
}
