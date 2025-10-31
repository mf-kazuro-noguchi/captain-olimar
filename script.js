let userLocation = null;
let allRestaurants = [];
let filteredRestaurants = [];

// DOMが完全に読み込まれてから実行
document.addEventListener('DOMContentLoaded', () => {
  const searchBtn = document.getElementById('searchBtn');
  const rouletteBtn = document.getElementById('rouletteBtn');
  
  if (searchBtn) {
    searchBtn.addEventListener('click', applyFiltersAndDisplay);
  }
  
  if (rouletteBtn) {
    rouletteBtn.addEventListener('click', executeRoulette);
  }
  
  // 移動時間が変更されたらAPI再呼び出し
  const timeRadios = document.querySelectorAll('input[name="time"]');
  timeRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      if (userLocation) {
        searchNearbyRestaurants();
      }
    });
  });
  
  getCurrentLocation();
});

// 現在地取得
function getCurrentLocation() {
  const statusElement = document.getElementById('status');
  
  if (!navigator.geolocation) {
    showError('位置情報がサポートされていないブラウザです');
    return;
  }

  navigator.geolocation.getCurrentPosition(
    position => {
      userLocation = {
        lat: position.coords.latitude,
        lng: position.coords.longitude
      };
      
      if (statusElement) {
        statusElement.innerHTML = `📍 現在地を取得しました`;
      }
      
      const searchBtn = document.getElementById('searchBtn');
      const rouletteBtn = document.getElementById('rouletteBtn');
      if (searchBtn) searchBtn.style.display = 'block';
      if (rouletteBtn) rouletteBtn.style.display = 'block';
      
      searchNearbyRestaurants();
    },
    error => {
      let errorMsg = '位置情報の取得に失敗しました: ';
      switch(error.code) {
        case error.PERMISSION_DENIED:
          errorMsg += '位置情報の使用が拒否されました。ブラウザの設定を確認してください。';
          break;
        case error.POSITION_UNAVAILABLE:
          errorMsg += '位置情報が利用できません。';
          break;
        case error.TIMEOUT:
          errorMsg += 'タイムアウトしました。';
          break;
        default:
          errorMsg += error.message;
      }
      showError(errorMsg);
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 300000
    }
  );
}

// 周辺の飲食店を検索
async function searchNearbyRestaurants() {
  if (!userLocation) {
    showError('位置情報が取得できていません');
    return;
  }

  const resultElement = document.getElementById('result');
  if (resultElement) {
    resultElement.innerHTML = '<p class="loading">🔍 検索中...</p>';
  }

  const selectedTime = document.querySelector('input[name="time"]:checked');
  const radius = selectedTime ? parseFloat(selectedTime.value) : 800;

  toggleButtons(false);

  try {
    if (typeof CONFIG === 'undefined' || !CONFIG.GOOGLE_API_KEY) {
      throw new Error('APIキーが設定されていません。config.jsを確認してください。');
    }

    const url = 'https://places.googleapis.com/v1/places:searchNearby';
    
    const requestBody = {
      includedTypes: ["restaurant"],
      maxResultCount: 20,
      locationRestriction: {
        circle: {
          center: {
            latitude: userLocation.lat,
            longitude: userLocation.lng
          },
          radius: radius
        }
      },
      languageCode: "ja"
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': CONFIG.GOOGLE_API_KEY,
        // 🆕 places.photos を追加
        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location,places.rating,places.priceLevel,places.types,places.googleMapsUri,places.id,places.photos'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`API Error: ${response.status} - ${errorData.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();
    
    if (!data.places || data.places.length === 0) {
      if (resultElement) {
        resultElement.innerHTML = 
          '<p class="error">⚠️ 周辺に飲食店が見つかりませんでした。移動時間を長くしてみてください。</p>';
      }
      allRestaurants = [];
      filteredRestaurants = [];
      updateResultCount();
      return;
    }

    allRestaurants = data.places.map(place => formatRestaurantData(place));
    applyFiltersAndDisplay();

  } catch (error) {
    console.error('Error:', error);
    showError('検索中にエラーが発生しました: ' + error.message);
  } finally {
    toggleButtons(true);
  }
}

// 店舗データを整形
function formatRestaurantData(place) {
  const distance = calculateDistance(
    userLocation.lat,
    userLocation.lng,
    place.location.latitude,
    place.location.longitude
  );
  
  // 🆕 写真URLを生成
  let photoUrl = null;
  if (place.photos && place.photos.length > 0) {
    const photoName = place.photos[0].name;
    // Places API (New) のPhoto URL形式
    photoUrl = `https://places.googleapis.com/v1/${photoName}/media?key=${CONFIG.GOOGLE_API_KEY}&maxHeightPx=400&maxWidthPx=600`;
  }
  
  return {
    id: place.id,
    name: place.displayName?.text || '店名不明',
    address: place.formattedAddress || '住所不明',
    lat: place.location.latitude,
    lng: place.location.longitude,
    distance: distance,
    travelTime: Math.ceil(distance / 80),
    rating: place.rating || null,
    priceLevel: place.priceLevel || null,
    types: place.types || [],
    googleMapsUri: place.googleMapsUri || null,
    mood: extractMood(place.types || []),
    photoUrl: photoUrl  // 🆕 写真URLを追加
  };
}

// typesから気分を判定
function extractMood(types) {
  const moods = [];
  
  const moodMap = {
    'light': ['sushi_restaurant', 'japanese_restaurant', 'seafood_restaurant', 'salad'],
    'heavy': ['ramen_restaurant', 'yakiniku_restaurant', 'barbecue_restaurant', 'curry_restaurant', 'steak_house', 'hamburger_restaurant'],
    'sweet': ['cafe', 'bakery', 'dessert_restaurant', 'ice_cream_shop', 'coffee_shop'],
    'fancy': ['italian_restaurant', 'french_restaurant', 'fine_dining_restaurant', 'wine_bar', 'spanish_restaurant']
  };
  
  for (let [mood, keywords] of Object.entries(moodMap)) {
    if (types.some(type => keywords.includes(type))) {
      moods.push(mood);
    }
  }
  
  return moods;
}

// フィルターを適用して表示
function applyFiltersAndDisplay() {
  const budget = document.querySelector('input[name="budget"]:checked')?.value;
  const mood = document.querySelector('input[name="mood"]:checked')?.value;
  
  filteredRestaurants = allRestaurants.filter(restaurant => {
    if (budget !== 'all') {
      if (!filterByBudget(restaurant.priceLevel, budget)) {
        return false;
      }
    }
    
    if (mood !== 'all') {
      if (!restaurant.mood.includes(mood)) {
        return false;
      }
    }
    
    return true;
  });
  
  updateResultCount();
  displayResults(filteredRestaurants, false);
}

// 予算でフィルタリング
function filterByBudget(priceLevel, budget) {
  if (!priceLevel) return true;
  
  const priceLevelMap = {
    'PRICE_LEVEL_INEXPENSIVE': 1,
    'PRICE_LEVEL_MODERATE': 2,
    'PRICE_LEVEL_EXPENSIVE': 3,
    'PRICE_LEVEL_VERY_EXPENSIVE': 4
  };
  
  const level = priceLevelMap[priceLevel] || 2;
  
  if (budget === '500') return level <= 1;
  if (budget === '1000') return level <= 2;
  if (budget === 'over') return level >= 3;
  
  return true;
}

// ルーレット実行
function executeRoulette() {
  if (filteredRestaurants.length === 0) {
    alert('条件に合う店舗がありません。条件を変更してください。');
    return;
  }
  
  const randomIndex = Math.floor(Math.random() * filteredRestaurants.length);
  const selected = filteredRestaurants[randomIndex];
  
  displayResults([selected], true);
  
  document.getElementById('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// 結果を表示
function displayResults(restaurants, isRouletteResult = false) {
  const resultDiv = document.getElementById('result');
  if (!resultDiv) return;

  if (restaurants.length === 0) {
    resultDiv.innerHTML = '<p class="error">⚠️ 条件に合う店舗が見つかりませんでした。条件を変更してみてください。</p>';
    return;
  }

  resultDiv.innerHTML = '';

  restaurants.forEach(restaurant => {
    const card = createRestaurantCard(restaurant, isRouletteResult);
    resultDiv.appendChild(card);
  });
}

// レストランカードを作成
function createRestaurantCard(restaurant, isHighlight = false) {
  const card = document.createElement('div');
  card.className = isHighlight ? 'restaurant-card selected-restaurant' : 'restaurant-card';
  
  let priceDisplay = '不明';
  if (restaurant.priceLevel) {
    const priceMap = {
      'PRICE_LEVEL_FREE': '無料',
      'PRICE_LEVEL_INEXPENSIVE': '¥',
      'PRICE_LEVEL_MODERATE': '¥¥',
      'PRICE_LEVEL_EXPENSIVE': '¥¥¥',
      'PRICE_LEVEL_VERY_EXPENSIVE': '¥¥¥¥'
    };
    priceDisplay = priceMap[restaurant.priceLevel] || '不明';
  }
  
  // 🆕 画像があれば表示
  const photoHTML = restaurant.photoUrl 
    ? `<img src="${restaurant.photoUrl}" alt="${restaurant.name}" class="restaurant-photo" onerror="this.style.display='none'">` 
    : '<div class="no-photo">📷 画像なし</div>';
  
  card.innerHTML = `
    ${photoHTML}
    <div class="restaurant-info">
      <h3>${restaurant.name}</h3>
      <p>📍 ${restaurant.address}</p>
      <p>🚶 徒歩約${restaurant.travelTime}分 (${restaurant.distance}m)</p>
      <p>⭐ 評価: ${restaurant.rating ? restaurant.rating.toFixed(1) + ' / 5.0' : '不明'}</p>
      <p>💰 価格: ${priceDisplay}</p>
      ${restaurant.googleMapsUri ? 
        `<a href="${restaurant.googleMapsUri}" target="_blank" class="map-link">📍 地図で見る</a>` : 
        ''}
    </div>
  `;
  
  return card;
}

// 結果件数を更新
function updateResultCount() {
  const countElement = document.getElementById('resultCount');
  if (countElement) {
    if (filteredRestaurants.length > 0) {
      countElement.textContent = `🍽️ 条件に合う店舗: ${filteredRestaurants.length}件`;
    } else if (allRestaurants.length > 0) {
      countElement.textContent = '⚠️ 条件に合う店舗がありません';
    } else {
      countElement.textContent = '';
    }
  }
}

// ボタンの有効/無効を切り替え
function toggleButtons(enabled) {
  const searchBtn = document.getElementById('searchBtn');
  const rouletteBtn = document.getElementById('rouletteBtn');
  
  if (searchBtn) {
    searchBtn.disabled = !enabled;
    searchBtn.textContent = enabled ? '🔍 条件で検索' : '検索中...';
  }
  
  if (rouletteBtn) {
    rouletteBtn.disabled = !enabled;
  }
}

// 2地点間の距離を計算
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return Math.round(R * c);
}

// エラー表示
function showError(message) {
  const statusElement = document.getElementById('status');
  if (statusElement) {
    statusElement.innerHTML = `<div class="error">❌ ${message}</div>`;
  }
  console.error('Error:', message);
}