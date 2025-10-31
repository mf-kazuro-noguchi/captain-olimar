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
        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location,places.rating,places.priceLevel,places.types,places.googleMapsUri,places.id,places.photos,places.currentOpeningHours,places.regularOpeningHours'
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
  
  // 写真URLを生成
  let photoUrl = null;
  if (place.photos && place.photos.length > 0) {
    const photoName = place.photos[0].name;
    photoUrl = `https://places.googleapis.com/v1/${photoName}/media?key=${CONFIG.GOOGLE_API_KEY}&maxHeightPx=400&maxWidthPx=600`;
  }
  
  // 営業時間情報を整形
  const openingHoursData = parseOpeningHours(place.currentOpeningHours, place.regularOpeningHours);
  
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
    photoUrl: photoUrl,
    openingHours: openingHoursData
  };
}

// 営業時間データを解析
function parseOpeningHours(currentHours, regularHours) {
  const result = {
    isOpen: null,
    is24Hours: false,
    isLateNight: false,
    weekdayTexts: []
  };
  
  // 現在営業中かどうか
  if (currentHours && currentHours.openNow !== undefined) {
    result.isOpen = currentHours.openNow;
  }
  
  // 営業時間の詳細
  if (regularHours) {
    // 24時間営業の判定
    if (regularHours.periods && regularHours.periods.length === 1) {
      const period = regularHours.periods[0];
      if (period.open && !period.close) {
        result.is24Hours = true;
      }
    }
    
    // 深夜営業の判定（23時以降も営業）
    if (regularHours.periods) {
      result.isLateNight = regularHours.periods.some(period => {
        if (period.close && period.close.hour >= 23) {
          return true;
        }
        // 翌日の早朝まで営業（例：2時まで）
        if (period.close && period.close.day !== period.open?.day) {
          return true;
        }
        return false;
      });
    }
    
    // 曜日別営業時間テキスト
    if (regularHours.weekdayDescriptions) {
      result.weekdayTexts = regularHours.weekdayDescriptions;
    }
  }
  
  return result;
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
  const hours = document.querySelector('input[name="hours"]:checked')?.value;
  
  filteredRestaurants = allRestaurants.filter(restaurant => {
    // 予算フィルター
    if (budget !== 'all') {
      if (!filterByBudget(restaurant.priceLevel, budget)) {
        return false;
      }
    }
    
    // 気分フィルター
    if (mood !== 'all') {
      if (!restaurant.mood.includes(mood)) {
        return false;
      }
    }
    
    // 営業時間フィルター
    if (hours !== 'all') {
      if (!filterByOpeningHours(restaurant.openingHours, hours)) {
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

// 営業時間でフィルタリング
function filterByOpeningHours(openingHours, hoursFilter) {
  if (!openingHours) return true;
  
  if (hoursFilter === 'open') {
    return openingHours.isOpen === true;
  }
  
  if (hoursFilter === '24h') {
    return openingHours.is24Hours === true;
  }
  
  if (hoursFilter === 'late') {
    return openingHours.isLateNight === true;
  }
  
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
  
  // 価格レベルから具体的な価格帯を推定
  let priceDisplay = '不明';
  let priceRangeDisplay = '';
  
  if (restaurant.priceLevel) {
    const priceInfo = getPriceInfo(restaurant.priceLevel);
    priceRangeDisplay = priceInfo.range;
  }
  
  // 画像
  const photoHTML = restaurant.photoUrl 
    ? `<img src="${restaurant.photoUrl}" alt="${restaurant.name}" class="restaurant-photo" onerror="this.style.display='none'">` 
    : '<div class="no-photo">📷 画像なし</div>';
  
  // 営業状況バッジ
  let openStatusHTML = '';
  if (restaurant.openingHours) {
    if (restaurant.openingHours.isOpen === true) {
      openStatusHTML = '<span class="open-status open">営業中</span>';
    } else if (restaurant.openingHours.isOpen === false) {
      openStatusHTML = '<span class="open-status closed">閉店中</span>';
    } else {
      openStatusHTML = '<span class="open-status unknown">不明</span>';
    }
    
    if (restaurant.openingHours.is24Hours) {
      openStatusHTML += '<span class="open-status open">24h</span>';
    } else if (restaurant.openingHours.isLateNight) {
      openStatusHTML += '<span class="open-status open">深夜</span>';
    }
  }
  
  // 営業時間詳細
  let hoursDetailHTML = '';
  if (restaurant.openingHours && restaurant.openingHours.weekdayTexts.length > 0) {
    hoursDetailHTML = '<div class="opening-hours">';
    hoursDetailHTML += '<strong>📅 営業時間:</strong><br>';
    restaurant.openingHours.weekdayTexts.forEach(text => {
      hoursDetailHTML += `<div class="opening-hours-detail">${text}</div>`;
    });
    hoursDetailHTML += '</div>';
  }
  
  card.innerHTML = `
    ${photoHTML}
    <div class="restaurant-info">
      <h3>${restaurant.name} ${openStatusHTML}</h3>
      <p>📍 ${restaurant.address}</p>
      <p>🚶 徒歩約${restaurant.travelTime}分 (${restaurant.distance}m)</p>
      <p>⭐ 評価: ${restaurant.rating ? restaurant.rating.toFixed(1) + ' / 5.0' : '不明'}</p>
      <p>💰 価格帯: ${priceRangeDisplay ? `<span class="price-range">(${priceRangeDisplay})</span>` : ''}</p>
      ${hoursDetailHTML}
      ${restaurant.googleMapsUri ? 
        `<a href="${restaurant.googleMapsUri}" target="_blank" class="map-link">📍 地図で見る</a>` : 
        ''}
    </div>
  `;
  
  return card;
}

// 価格レベルから価格帯情報を取得
function getPriceInfo(priceLevel) {
  const priceMap = {
    'PRICE_LEVEL_FREE': {
      symbol: '無料',
      range: ''
    },
    'PRICE_LEVEL_INEXPENSIVE': {
      symbol: '¥',
      range: '〜500円'
    },
    'PRICE_LEVEL_MODERATE': {
      symbol: '¥¥',
      range: '500円〜1,000円'
    },
    'PRICE_LEVEL_EXPENSIVE': {
      symbol: '¥¥¥',
      range: '1,000円〜2,000円'
    },
    'PRICE_LEVEL_VERY_EXPENSIVE': {
      symbol: '¥¥¥¥',
      range: '2,000円〜'
    }
  };
  
  return priceMap[priceLevel] || { symbol: '不明', range: '' };
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

// 2地点間の距離を計算（Haversine公式）
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