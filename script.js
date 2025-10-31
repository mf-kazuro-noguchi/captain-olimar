let userLocation = null;
let restaurants = [];
let selectedRestaurant = null; // To store the restaurant selected by roulette

// 初期化
async function init() {
  try {
    // 位置情報取得
    const position = await getCurrentPosition();
    userLocation = {
      lat: position.coords.latitude,
      lng: position.coords.longitude
    };
    
    document.getElementById('status').textContent = 
      `📍 現在地: ${userLocation.lat.toFixed(4)}, ${userLocation.lng.toFixed(4)}`;
    
    // 店舗検索
    await fetchNearbyRestaurants(800); // Initial search radius of 800m
    
  } catch (error) {
    console.error('Error:', error);
    document.getElementById('status').textContent = 
      '❌ エラーが発生しました: ' + error.message;
    handleLocationError(error);
  }
}

// 位置情報取得
function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('位置情報がサポートされていません'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 300000 // 5分間キャッシュ
    });
  });
}

// Google Places API呼び出し
function fetchNearbyRestaurants(radius) {
  return new Promise((resolve, reject) => {
    // Check if google.maps.places is available
    if (typeof google === 'undefined' || typeof google.maps === 'undefined' || typeof google.maps.places === 'undefined') {
      reject(new Error('Google Places APIが読み込まれていません。APIキーを確認してください。'));
      return;
    }

    const map = new google.maps.Map(document.createElement('div'));
    const service = new google.maps.places.PlacesService(map);
    
    const request = {
      location: new google.maps.LatLng(userLocation.lat, userLocation.lng),
      radius: radius,
      type: 'restaurant',
      language: 'ja'
    };
    
    service.nearbySearch(request, (results, status) => {
      if (status === google.maps.places.PlacesServiceStatus.OK && results) {
        restaurants = formatRestaurantData(results, userLocation.lat, userLocation.lng);
        document.getElementById('restaurant-count').textContent = 
          `😎 周辺の店舗: ${restaurants.length}件見つかりました`;
        resolve(restaurants);
      } else if (status === google.maps.places.PlacesServiceStatus.ZERO_RESULTS) {
        restaurants = [];
        document.getElementById('restaurant-count').textContent = 
          `😎 周辺の店舗: 0件見つかりませんでした`;
        resolve([]);
      } else {
        reject(new Error('店舗検索に失敗しました: ' + status));
      }
    });
  });
}

// 距離計算(Haversine formula)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // 地球の半径(m)
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  
  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  
  return Math.round(R * c); // メートル
}

// データ整形
function formatRestaurantData(apiResults, userLat, userLng) {
  return apiResults.map(place => ({
    id: place.place_id,
    name: place.name,
    genre: extractGenre(place.types),
    address: place.vicinity,
    lat: place.geometry.location.lat,
    lng: place.geometry.location.lng,
    distance: calculateDistance(userLat, userLng, place.geometry.location.lat, place.geometry.location.lng),
    travelTime: Math.ceil(calculateDistance(userLat, userLng, place.geometry.location.lat, place.geometry.location.lng) / 80), // 80m/分
    budget: convertPriceLevel(place.price_level),
    priceLevel: place.price_level || 2,
    mood: extractMood(place.types),
    rating: place.rating || 0,
    isOpen: place.opening_hours?.open_now || null,
    placeId: place.place_id
  }));
}

// ジャンル抽出
function extractGenre(types) {
  const genreMap = {
    'ramen_restaurant': 'ラーメン',
    'sushi_restaurant': '寿司',
    'curry_restaurant': 'カレー',
    'italian_restaurant': 'イタリアン',
    'french_restaurant': 'フレンチ',
    'yakiniku_restaurant': '焼肉',
    'cafe': 'カフェ',
    'bakery': 'ベーカリー',
    'japanese_restaurant': '和食',
    'restaurant': 'レストラン',
    'food': '料理'
  };
  
  for (let type of types) {
    if (genreMap[type]) return genreMap[type];
  }
  return 'その他';
}

// 気分抽出
function extractMood(types) {
  const moods = [];
  const moodMap = {
    'さっぱり': ['japanese_restaurant', 'sushi_restaurant', 'salad', 'healthy'],
    'がっつり': ['ramen_restaurant', 'yakiniku_restaurant', 'curry_restaurant', 'meat'],
    '甘いもの': ['cafe', 'bakery', 'dessert', 'ice_cream'],
    'おしゃれ': ['italian_restaurant', 'french_restaurant', 'cafe', 'bistro']
  };
  
  for (let [mood, keywords] of Object.entries(moodMap)) {
    if (types.some(type => keywords.includes(type))) {
      moods.push(mood);
    }
  }
  
  return moods.length > 0 ? moods : ['がっつり']; // デフォルト
}

// price_level変換
function convertPriceLevel(level) {
  if (level === 0) return '無料';
  if (level === 1) return '500円以下';
  if (level === 2) return '1000円以下';
  if (level >= 3) return 'それ以上';
  return '不明';
}

// エラーハンドリング
function handleLocationError(error) {
  let message;
  
  switch(error.code) {
    case error.PERMISSION_DENIED:
      message = "位置情報の使用が拒否されました。ブラウザの設定を確認してください。";
      break;
    case error.POSITION_UNAVAILABLE:
      message = "位置情報が取得できませんでした。";
      break;
    case error.TIMEOUT:
      message = "位置情報の取得がタイムアウトしました。";
      break;
    default:
      message = "エラーが発生しました。";
  }
  
  document.getElementById('status').textContent = '❌ ' + message;
  // フォールバック: デフォルト位置(例: 東京駅)を使用
  // userLocation = { lat: 35.6812, lng: 139.7671 }; // 東京駅
  // fetchNearbyRestaurants(800); // デフォルト位置で再検索
}

// フィルタリングロジック
function filterRestaurants(allRestaurants, budget, mood, travelTime) {
  return allRestaurants.filter(restaurant => {
    // 予算チェック
    if (budget && restaurant.budget !== budget) return false;
    
    // 気分チェック(配列内に含まれているか)
    if (mood && !restaurant.mood.includes(mood)) return false;
    
    // 移動時間チェック
    if (travelTime) {
      const maxTime = parseTimeRange(travelTime); // "5分以内" → 5
      if (restaurant.travelTime > maxTime) return false;
    }
    
    // 営業中チェック(オプション)
    // if (restaurant.isOpen === false) return false;
    
    return true;
  });
}

function parseTimeRange(timeStr) {
  const match = timeStr.match(/(\d+)分/);
  return match ? parseInt(match[1]) : 999; // 20分以上の場合も考慮
}

// ルーレット実行
document.getElementById('rouletteBtn').addEventListener('click', () => {
  const selectedBudget = document.querySelector('input[name="budget"]:checked')?.value;
  const selectedMood = document.querySelector('input[name="mood"]:checked')?.value;
  const selectedTravelTime = document.querySelector('input[name="travelTime"]:checked')?.value;

  const filtered = filterRestaurants(restaurants, selectedBudget, selectedMood, selectedTravelTime);

  if (filtered.length === 0) {
    document.getElementById('result').innerHTML = `
      <p>条件に合う店舗が見つかりませんでした。条件を変えてみてください。</p>
    `;
    selectedRestaurant = null;
    return;
  }
  
  const randomIndex = Math.floor(Math.random() * filtered.length);
  selectedRestaurant = filtered[randomIndex];
  const withCompanion = document.getElementById('companionCheckbox').checked;
  
  // 結果表示
  let resultHTML = `
    <h2>こっては『${selectedRestaurant.name}』!</h2>
    <p>ジャンル: ${selectedRestaurant.genre}</p>
    <p>移動時間: 歩い約${selectedRestaurant.travelTime}分 (${selectedRestaurant.distance}m)</p>
    <p>予算: ${selectedRestaurant.budget} | 評価: ${'★'.repeat(Math.floor(selectedRestaurant.rating))} ${selectedRestaurant.rating}</p>
  `;
  
  if (withCompanion) {
    resultHTML += `<p>♿ 同行者: 福室さん</p>`;
  }
  
  resultHTML += `
    <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selectedRestaurant.name)}&query_place_id=${selectedRestaurant.placeId}" target="_blank">
      📍 地図で見る
    </a>
    <button id="addToOutlookBtn" style="display:block; margin-top:10px;">
      📅 Outlookに予定を追加
    </button>
  `;
  
  document.getElementById('result').innerHTML = resultHTML;
  
  // Outlookボタンのイベント
  document.getElementById('addToOutlookBtn').addEventListener('click', () => {
    if (selectedRestaurant) {
      downloadICSFile(selectedRestaurant, withCompanion);
      alert('カレンダーファイルをダウンロードしました！\nファイルを開いてOutlookに登録してください。');
    } else {
      alert('店舗が選択されていません。');
    }
  });
});

// .icsファイル生成・ダウンロード
function downloadICSFile(restaurant, withCompanion) {
  const today = new Date();
  const lunchStart = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12, 0, 0);
  const lunchEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 13, 0, 0);
  
  const formatICSDate = (date) => {
    return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  };
  
  let icsContent = `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//ランチルーレット//JP\nCALSCALE:GREGORIAN\nMETHOD:REQUEST\nBEGIN:VEVENT\nUID:lunch-${Date.now()}@lunch-roulette.com\nDTSTAMP:${formatICSDate(new Date())}\nDTSTART:${formatICSDate(lunchStart)}\nDTEND:${formatICSDate(lunchEnd)}\nSUMMARY:🍴 ランチ @ ${restaurant.name}\nLOCATION:${restaurant.name} - ${restaurant.address}\nDESCRIPTION:ランチルーレットで決定！\n\nジャンル: ${restaurant.genre}\n予算: ${restaurant.budget}\n評価: ${'★'.repeat(Math.floor(restaurant.rating))}\n移動時間: 徒歩約${restaurant.travelTime}分\n\nGoogle Maps: https://www.google.com/maps/search/?api=1&query_place_id=${restaurant.placeId}\n`;

  if (withCompanion) {
    icsContent += `ATTENDEE;CN=福室;RSVP=TRUE;PARTSTAT=NEEDS-ACTION;ROLE=REQ-PARTICIPANT:mailto:${CONFIG.FUKUMURO_EMAIL || 'fukumuro@example.com'}\n`;
  }
  
  icsContent += `STATUS:CONFIRMED\nSEQUENCE:0\nEND:VEVENT\nEND:VCALENDAR`;

  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `lunch-${restaurant.name.replace(/[^a-zA-Z0-9]/g, '-')}-${Date.now()}.ics`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

// フィルター変更時の処理 (移動時間フィルターのみAPI再検索が必要)
document.querySelectorAll('input[name="travelTime"]').forEach(radio => {
  radio.addEventListener('change', async (event) => {
    const selectedTravelTime = event.target.value;
    const radius = getRadiusFromTravelTime(selectedTravelTime);
    if (userLocation) {
      document.getElementById('status').textContent = '店舗情報を更新中...';
      await fetchNearbyRestaurants(radius);
      document.getElementById('status').textContent = 
        `📍 現在地: ${userLocation.lat.toFixed(4)}, ${userLocation.lng.toFixed(4)}`;
    }
  });
});

function getRadiusFromTravelTime(travelTime) {
  switch (travelTime) {
    case '5分以内': return 400;
    case '10分以内': return 800;
    case '15分以内': return 1200;
    case '20分以上': return 1600;
    default: return 800; // Default to 10 minutes
  }
}

// ページ読み込み時に初期化
window.addEventListener('load', init);
