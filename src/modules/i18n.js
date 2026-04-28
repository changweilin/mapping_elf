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
  '匯入路線（GPX / KML / YAML）': { en: 'Import route (GPX / KML / YAML)', ja: 'ルートをインポート（GPX / KML / YAML）', ko: '루트 가져오기 (GPX / KML / YAML)', fr: 'Importer un itinéraire (GPX / KML / YAML)', de: 'Route importieren (GPX / KML / YAML)', es: 'Importar ruta (GPX / KML / YAML)', it: 'Importa percorso (GPX / KML / YAML)' },
  '匯出路線': { en: 'Export route', ja: 'ルートを書き出す', ko: '루트 내보내기', fr: 'Exporter l’itinéraire', de: 'Route exportieren', es: 'Exportar ruta', it: 'Esporta percorso' },
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
  '重新規劃路線': { en: 'Replan route', ja: 'ルートを再計算', ko: '루트 다시 계획', fr: 'Replanifier l’itinéraire', de: 'Route neu planen', es: 'Replanificar ruta', it: 'Ricalcola percorso' },
  '加入我的最愛': { en: 'Add to favorites', ja: 'お気に入りに追加', ko: '즐겨찾기에 추가', fr: 'Ajouter aux favoris', de: 'Zu Favoriten hinzufügen', es: 'Añadir a favoritos', it: 'Aggiungi ai preferiti' },
  '打開我的最愛清單': { en: 'Open favorites', ja: 'お気に入りを開く', ko: '즐겨찾기 열기', fr: 'Ouvrir les favoris', de: 'Favoriten öffnen', es: 'Abrir favoritos', it: 'Apri preferiti' },
  '清除路線': { en: 'Clear route', ja: 'ルートを消去', ko: '루트 지우기', fr: 'Effacer l’itinéraire', de: 'Route löschen', es: 'Borrar ruta', it: 'Cancella percorso' },
  '路線規劃': { en: 'Route planning', ja: 'ルート計画', ko: '루트 계획', fr: 'Planification d’itinéraire', de: 'Routenplanung', es: 'Planificación de ruta', it: 'Pianificazione percorso' },
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
  '公式摘要': { en: 'Formula summary', ja: '計算式の概要', ko: '공식 요약', fr: 'Résumé de la formule', de: 'Formelübersicht', es: 'Resumen de fórmula', it: 'Riepilogo formula' },
  '個人配速校正': { en: 'Personal pace calibration', ja: '個人ペース補正', ko: '개인 페이스 보정', fr: 'Calibration personnelle', de: 'Persönliche Tempo-Kalibrierung', es: 'Calibración personal', it: 'Calibrazione personale' },
  '啟用個人校正': { en: 'Enable personal calibration', ja: '個人補正を有効化', ko: '개인 보정 사용', fr: 'Activer la calibration', de: 'Kalibrierung aktivieren', es: 'Activar calibración', it: 'Attiva calibrazione' },
  '載入軌跡': { en: 'Load tracks', ja: '軌跡を読み込む', ko: '트랙 불러오기', fr: 'Charger des traces', de: 'Tracks laden', es: 'Cargar tracks', it: 'Carica tracce' },
  '計算校正': { en: 'Calculate calibration', ja: '補正を計算', ko: '보정 계산', fr: 'Calculer', de: 'Kalibrierung berechnen', es: 'Calcular', it: 'Calcola' },
  '清除': { en: 'Clear', ja: 'クリア', ko: '지우기', fr: 'Effacer', de: 'Löschen', es: 'Borrar', it: 'Cancella' },
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
  '雷達': { en: 'Radar', ja: 'レーダー', ko: '레이더', fr: 'Radar', de: 'Radar', es: 'Radar', it: 'Radar' },
  '雷暴': { en: 'Thunderstorms', ja: '雷雨', ko: '뇌우', fr: 'Orages', de: 'Gewitter', es: 'Tormentas', it: 'Temporali' },
  '累積雨量': { en: 'Rain accumulation', ja: '積算雨量', ko: '누적 강수량', fr: 'Cumul de pluie', de: 'Regenmenge', es: 'Lluvia acumulada', it: 'Accumulo pioggia' },
  '波浪': { en: 'Waves', ja: '波', ko: '파도', fr: 'Vagues', de: 'Wellen', es: 'Olas', it: 'Onde' },
  '空氣品質': { en: 'Air quality', ja: '空気質', ko: '대기질', fr: 'Qualité de l’air', de: 'Luftqualität', es: 'Calidad del aire', it: 'Qualità dell’aria' },
  '比較預報': { en: 'Compare models', ja: '予報比較', ko: '예보 비교', fr: 'Comparer les modèles', de: 'Modelle vergleichen', es: 'Comparar modelos', it: 'Confronta modelli' },
  '操作說明': { en: 'Instructions', ja: '操作説明', ko: '사용 방법', fr: 'Mode d’emploi', de: 'Anleitung', es: 'Instrucciones', it: 'Istruzioni' },
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
}

export function initI18n(options = {}) {
  onLanguageChange = options.onLanguageChange || null;
  installLanguageSelect();
  applyTranslations();
  if (!observer && document.body) {
    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE) translateTree(node);
        });
        if (mutation.type === 'characterData') translateTree(mutation.target);
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
