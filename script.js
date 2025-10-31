let userLocation = null;
let allRestaurants = [];
let filteredRestaurants = [];
let selectedCompanion = null;

// 🆕 同行者リスト（画像パス追加）
const COMPANION_POOL = [
  { name: "福室さん", country: "JPN", image: "images/fukumuro.jpg" },
  { name: "興津さん", country: "JPN", image: "images/okitsu.jpg" },
  { name: "森さん", country: "JPN", image: "images/mori.jpg" },
  { name: "木村さん", country: "JPN", image: "images/kimura.jpg" },
  { name: "佐藤さん", country: "JPN", image: "images/sato.jpg" },
  { name: "鈴木さん", country: "JPN", image: "images/suzuki.jpg" },
  { name: "高橋さん", country: "JPN", image: "images/takahashi.jpg" },
  { name: "山本さん", country: "JPN", image: "images/yamamoto.jpg" },
  { name: "中村さん", country: "JPN", image: "images/nakamura.jpg" },
  { name: "小林さん", country: "JPN", image: "images/kobayashi.jpg" },
  { name: "渡辺さん", country: "JPN", image: "images/watanabe.jpg" },
];

const COMPANION_FINAL = COMPANION_POOL[0]; // 必ず福室さんが選ばれる
let companionAnimationInterval = null;
let companionAnimationTimeout = null;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// DOMが完全に読み込まれてから実行
document.addEventListener("DOMContentLoaded", () => {
  const searchBtn = document.getElementById("searchBtn");
  const rouletteBtn = document.getElementById("rouletteBtn");
  const companionToggle = document.getElementById("companionCheckbox"); // 🆕

  if (searchBtn) {
    searchBtn.addEventListener("click", applyFiltersAndDisplay);
  }

  if (rouletteBtn) {
    rouletteBtn.addEventListener("click", executeRoulette);
  }

  // 🆕 同行者チェックボックスのイベントリスナー
  if (companionToggle) {
    const updateCompanionVisibility = () => {
      setCompanionVisibility(companionToggle.checked);
    };
    companionToggle.addEventListener("change", updateCompanionVisibility);
    updateCompanionVisibility();
  } else {
    setCompanionVisibility(false);
  }

  // 移動時間が変更されたらAPI再呼び出し
  const timeRadios = document.querySelectorAll('input[name="time"]');
  timeRadios.forEach((radio) => {
    radio.addEventListener("change", () => {
      if (userLocation) {
        searchNearbyRestaurants();
      }
    });
  });

  getCurrentLocation();
});

// 現在地取得
function getCurrentLocation() {
  const statusElement = document.getElementById("status");

  if (!navigator.geolocation) {
    showError("位置情報がサポートされていないブラウザです");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      userLocation = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };

      if (statusElement) {
        statusElement.innerHTML = `📍 現在地を取得しました`;
      }

      const searchBtn = document.getElementById("searchBtn");
      const rouletteBtn = document.getElementById("rouletteBtn");
      if (searchBtn) searchBtn.style.display = "block";
      if (rouletteBtn) rouletteBtn.style.display = "block";

      searchNearbyRestaurants();
    },
    (error) => {
      let errorMsg = "位置情報の取得に失敗しました: ";
      switch (error.code) {
        case error.PERMISSION_DENIED:
          errorMsg +=
            "位置情報の使用が拒否されました。ブラウザの設定を確認してください。";
          break;
        case error.POSITION_UNAVAILABLE:
          errorMsg += "位置情報が利用できません。";
          break;
        case error.TIMEOUT:
          errorMsg += "タイムアウトしました。";
          break;
        default:
          errorMsg += error.message;
      }
      showError(errorMsg);
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 300000,
    }
  );
}

// 周辺の飲食店を検索
async function searchNearbyRestaurants() {
  if (!userLocation) {
    showError("位置情報が取得できていません");
    return;
  }

  const resultElement = document.getElementById("result");
  if (resultElement) {
    resultElement.innerHTML = '<p class="loading">🔍 検索中...</p>';
  }

  const selectedTime = document.querySelector('input[name="time"]:checked');
  const radius = selectedTime ? parseFloat(selectedTime.value) : 800;

  toggleButtons(false, "search");

  try {
    if (typeof CONFIG === "undefined" || !CONFIG.GOOGLE_API_KEY) {
      throw new Error(
        "APIキーが設定されていません。config.jsを確認してください。"
      );
    }

    const url = "https://places.googleapis.com/v1/places:searchNearby";

    const requestBody = {
      includedTypes: ["restaurant"],
      maxResultCount: 20,
      locationRestriction: {
        circle: {
          center: {
            latitude: userLocation.lat,
            longitude: userLocation.lng,
          },
          radius: radius,
        },
      },
      languageCode: "ja",
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": CONFIG.GOOGLE_API_KEY,
        "X-Goog-FieldMask":
          "places.displayName,places.formattedAddress,places.location,places.rating,places.priceLevel,places.types,places.googleMapsUri,places.id,places.photos,places.currentOpeningHours,places.regularOpeningHours",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        `API Error: ${response.status} - ${
          errorData.error?.message || "Unknown error"
        }`
      );
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

    allRestaurants = data.places.map((place) => formatRestaurantData(place));
    applyFiltersAndDisplay();
  } catch (error) {
    console.error("Error:", error);
    showError("検索中にエラーが発生しました: " + error.message);
  } finally {
    toggleButtons(true, "search");
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

  let photoUrl = null;
  if (place.photos && place.photos.length > 0) {
    const photoName = place.photos[0].name;
    photoUrl = `https://places.googleapis.com/v1/${photoName}/media?key=${CONFIG.GOOGLE_API_KEY}&maxHeightPx=400&maxWidthPx=600`;
  }

  const openingHoursData = parseOpeningHours(
    place.currentOpeningHours,
    place.regularOpeningHours
  );

  return {
    id: place.id,
    name: place.displayName?.text || "店名不明",
    address: place.formattedAddress || "住所不明",
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
    openingHours: openingHoursData,
  };
}

// 営業時間データを解析
function parseOpeningHours(currentHours, regularHours) {
  const result = {
    isOpen: null,
    is24Hours: false,
    isLateNight: false,
    weekdayTexts: [],
  };

  if (currentHours && currentHours.openNow !== undefined) {
    result.isOpen = currentHours.openNow;
  }

  if (regularHours) {
    if (regularHours.periods && regularHours.periods.length === 1) {
      const period = regularHours.periods[0];
      if (period.open && !period.close) {
        result.is24Hours = true;
      }
    }

    if (regularHours.periods) {
      result.isLateNight = regularHours.periods.some((period) => {
        if (period.close && period.close.hour >= 23) {
          return true;
        }
        if (period.close && period.close.day !== period.open?.day) {
          return true;
        }
        return false;
      });
    }

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
    light: [
      "sushi_restaurant",
      "japanese_restaurant",
      "seafood_restaurant",
      "salad",
    ],
    heavy: [
      "ramen_restaurant",
      "yakiniku_restaurant",
      "barbecue_restaurant",
      "curry_restaurant",
      "steak_house",
      "hamburger_restaurant",
    ],
    sweet: [
      "cafe",
      "bakery",
      "dessert_restaurant",
      "ice_cream_shop",
      "coffee_shop",
    ],
    fancy: [
      "italian_restaurant",
      "french_restaurant",
      "fine_dining_restaurant",
      "wine_bar",
      "spanish_restaurant",
    ],
  };

  for (let [mood, keywords] of Object.entries(moodMap)) {
    if (types.some((type) => keywords.includes(type))) {
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

  filteredRestaurants = allRestaurants.filter((restaurant) => {
    if (budget !== "all") {
      if (!filterByBudget(restaurant.priceLevel, budget)) {
        return false;
      }
    }

    if (mood !== "all") {
      if (!restaurant.mood.includes(mood)) {
        return false;
      }
    }

    if (hours !== "all") {
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
    PRICE_LEVEL_INEXPENSIVE: 1,
    PRICE_LEVEL_MODERATE: 2,
    PRICE_LEVEL_EXPENSIVE: 3,
    PRICE_LEVEL_VERY_EXPENSIVE: 4,
  };

  const level = priceLevelMap[priceLevel] || 2;

  if (budget === "500") return level <= 1;
  if (budget === "1000") return level <= 2;
  if (budget === "over") return level >= 3;

  return true;
}

// 営業時間でフィルタリング
function filterByOpeningHours(openingHours, hoursFilter) {
  if (!openingHours) return true;

  if (hoursFilter === "open") {
    return openingHours.isOpen === true;
  }

  if (hoursFilter === "24h") {
    return openingHours.is24Hours === true;
  }

  if (hoursFilter === "late") {
    return openingHours.isLateNight === true;
  }

  return true;
}

// 🆕 同行者の表示/非表示を切り替え
function setCompanionVisibility(isVisible) {
  const container = document.getElementById("companionRoulette");
  if (!container) {
    return;
  }

  container.setAttribute("aria-hidden", String(!isVisible));

  if (isVisible) {
    container.classList.add("is-visible");
    selectedCompanion = null;
    resetCompanionAnimation(true);
  } else {
    container.classList.remove("is-visible");
    container.classList.remove("is-animating");
    container.classList.remove("is-complete");
    selectedCompanion = null;
    resetCompanionAnimation(true);
  }
}

// 🆕 同行者アニメーションをリセット
function resetCompanionAnimation(clearDisplay = false) {
  if (companionAnimationInterval) {
    clearInterval(companionAnimationInterval);
    companionAnimationInterval = null;
  }

  if (companionAnimationTimeout) {
    clearTimeout(companionAnimationTimeout);
    companionAnimationTimeout = null;
  }

  const container = document.getElementById("companionRoulette");
  const nameEl = document.getElementById("companionNameDisplay");
  const countryEl = document.getElementById("companionCountryDisplay");
  const statusEl = document.getElementById("companionStatusText");
  const lightEl = document.getElementById("companionIpponLight");
  const wazaEl = document.getElementById("companionScoreWaza");
  const ipponEl = document.getElementById("companionScoreIppon");

  if (container) {
    container.classList.remove("is-animating");
    container.classList.remove("is-complete");
  }

  if (lightEl) {
    lightEl.classList.remove("is-glowing");
  }

  if (wazaEl) {
    wazaEl.classList.remove("is-active");
  }

  if (ipponEl) {
    ipponEl.classList.remove("is-active");
  }

  if (clearDisplay) {
    if (nameEl) {
      nameEl.textContent = "選手未決定";
    }
    if (countryEl) {
      countryEl.textContent = "---";
    }
    if (statusEl) {
      statusEl.textContent = "畳の上で選手がウォームアップ中...";
    }
  }
}

// 🆕 同行者リストをシャッフル
function shuffleCompanions(list) {
  const array = list.slice();
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function easeInOutCubic(t) {
  if (t < 0.5) {
    return 4 * t * t * t;
  }
  return 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function animateCompanionReel(
  slotReel,
  itemHeight,
  totalItems,
  duration = 10000
) {
  if (!slotReel || totalItems <= 1 || itemHeight <= 0) {
    return Promise.resolve();
  }

  const totalTravel = (totalItems - 1) * itemHeight;
  slotReel.style.transform = "translateY(0)";
  slotReel.style.transition = "none";
  slotReel.style.willChange = "transform";

  return new Promise((resolve) => {
    const start = performance.now();

    const step = (now) => {
      if (!document.body.contains(slotReel)) {
        resolve();
        return;
      }

      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = easeInOutCubic(progress);
      slotReel.style.transform = `translateY(-${eased * totalTravel}px)`;

      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        resolve();
      }
    };

    requestAnimationFrame(step);
  }).then(() => {
    slotReel.style.willChange = "";
  });
}

function adjustSlotDisplay(slotReel, options = {}) {
  if (!slotReel) {
    return;
  }

  const slotDisplay = slotReel.closest(".companion-slot-display");
  if (!slotDisplay) {
    return;
  }

  const {
    extraPadding = 16,
    transitionDuration = 0.35,
    overflow = "visible",
  } = options;

  const updateDisplaySize = () => {
    const finalItem = slotReel.firstElementChild;
    if (!finalItem) {
      return;
    }

    const finalRect = finalItem.getBoundingClientRect();
    if (finalRect.height > 0) {
      slotDisplay.style.transition = `height ${transitionDuration}s ease`;
      slotDisplay.style.height = `${Math.ceil(
        finalRect.height + extraPadding
      )}px`;
    }

    slotDisplay.style.overflow = overflow;
  };

  requestAnimationFrame(updateDisplaySize);
}

function updateCompanionStage(
  companion,
  { statusText = null, isFinal = false } = {}
) {
  const container = document.getElementById("companionRoulette");
  const nameEl = document.getElementById("companionNameDisplay");
  const countryEl = document.getElementById("companionCountryDisplay");
  const statusEl = document.getElementById("companionStatusText");
  const lightEl = document.getElementById("companionIpponLight");
  const wazaEl = document.getElementById("companionScoreWaza");
  const ipponEl = document.getElementById("companionScoreIppon");

  if (nameEl) {
    nameEl.textContent = companion?.name || "選手未決定";
  }
  if (countryEl) {
    countryEl.textContent = companion?.country || "---";
  }
  if (statusEl && typeof statusText === "string") {
    statusEl.textContent = statusText;
  }

  if (wazaEl) {
    wazaEl.classList.toggle("is-active", !isFinal && Boolean(companion));
  }
  if (ipponEl) {
    ipponEl.classList.toggle("is-active", isFinal && Boolean(companion));
  }
  if (lightEl) {
    lightEl.classList.toggle("is-glowing", isFinal && Boolean(companion));
  }
  if (container) {
    const hasCompanion = Boolean(companion);
    container.classList.toggle("is-animating", hasCompanion && !isFinal);
    container.classList.toggle("is-complete", isFinal && hasCompanion);
  }
}

// 🎰 同行者スロット演出（全員表示版）
async function runCompanionRoulette() {
  // スロットマシン要素を動的に作成
  const slotMachine = document.createElement("div");
  slotMachine.className = "companion-slot-machine";
  slotMachine.innerHTML = `
    <div class="companion-slot-container">
      <div class="companion-slot-title">🥋 一緒に行く人は...</div>
      <div class="companion-slot-display">
        <div class="companion-slot-reel" id="companionSlotReel">
          <div class="companion-slot-item">
            <div class="companion-slot-name">???</div>
          </div>
        </div>
      </div>
      <div class="companion-slot-arrows">
        <div class="companion-arrow-left">◀</div>
        <div class="companion-arrow-right">▶</div>
      </div>
    </div>
  `;

  document.body.appendChild(slotMachine);
  document.body.classList.add("slot-active");

  const slotReel = document.getElementById("companionSlotReel");

  if (!slotReel) {
    document.body.classList.remove("slot-active");
    if (document.body.contains(slotMachine)) {
      document.body.removeChild(slotMachine);
    }
    selectedCompanion = COMPANION_FINAL;
    return COMPANION_FINAL;
  }

  const slotDisplay = slotReel.closest(".companion-slot-display");
  if (slotDisplay) {
    slotDisplay.style.height = "";
    slotDisplay.style.overflow = "hidden";
  }

  const initialWinnerCandidates = COMPANION_POOL.filter(
    (companion) => companion.name !== COMPANION_FINAL.name
  );
  const initialWinner =
    initialWinnerCandidates[
      Math.floor(Math.random() * initialWinnerCandidates.length)
    ] || COMPANION_FINAL;

  const slotItems = [];

  for (let round = 0; round < 5; round++) {
    const shuffled = shuffleCompanions(COMPANION_POOL);
    slotItems.push(...shuffled);
  }

  slotItems.push(initialWinner);

  console.log(
    `🎰 スロット表示数: ${slotItems.length}人 (初回当選候補: ${initialWinner.name})`,
    slotItems.map((c) => c.name)
  );

  slotReel.innerHTML = slotItems
    .map(
      (companion) => `
    <div class="companion-slot-item">
      <img src="${companion.image}" alt="${companion.name}" class="companion-slot-image" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22200%22%3E%3Crect fill=%22%23ddd%22 width=%22200%22 height=%22200%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 font-size=%2224%22 fill=%22%23999%22%3E👤%3C/text%3E%3C/svg%3E'">
      <div class="companion-slot-name">${companion.name}</div>
    </div>
  `
    )
    .join("");

  try {
    await delay(50);

    const firstItemEl = slotReel.querySelector(".companion-slot-item");
    const itemHeight = firstItemEl
      ? firstItemEl.getBoundingClientRect().height
      : 260;
    const spinDuration = 10000;
    const pauseBeforeFinalReveal = 800;
    const initialResultHold = 1400;
    const pauseAfterFinalReveal = 3000;

    await animateCompanionReel(
      slotReel,
      itemHeight,
      slotItems.length,
      spinDuration
    );
    slotReel.style.transform = `translateY(-${
      Math.max(slotItems.length - 1, 0) * itemHeight
    }px)`;

    await delay(pauseBeforeFinalReveal);

    slotReel.innerHTML = `
      <div class="companion-slot-item final is-fake">
        <img src="${initialWinner.image}" alt="${initialWinner.name}" class="companion-slot-image" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22200%22%3E%3Crect fill=%22%23ddd%22 width=%22200%22 height=%22200%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 font-size=%2224%22 fill=%22%23999%22%3E👤%3C/text%3E%3C/svg%3E'">
        <div class="companion-slot-name">${initialWinner.name} 🎉</div>
      </div>
    `;
    slotReel.style.transition = "transform 0.35s ease-out";
    slotReel.style.transform = "translateY(0)";
    adjustSlotDisplay(slotReel, { overflow: "hidden" });

    updateCompanionStage(initialWinner, {
      statusText: `${initialWinner.name}さんが当選!?`,
      isFinal: false,
    });

    await delay(initialResultHold);

    slotReel.innerHTML = `
      <div class="companion-slot-item final">
        <img src="${COMPANION_FINAL.image}" alt="${COMPANION_FINAL.name}" class="companion-slot-image" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22200%22%3E%3Crect fill=%22%23ddd%22 width=%22200%22 height=%22200%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 font-size=%2224%22 fill=%22%23999%22%3E👤%3C/text%3E%3C/svg%3E'">
        <div class="companion-slot-name">${COMPANION_FINAL.name} 🥇</div>
      </div>
    `;

    adjustSlotDisplay(slotReel);

    updateCompanionStage(COMPANION_FINAL, {
      statusText: `${COMPANION_FINAL.name}さんが割り込んで優勝！`,
      isFinal: true,
    });

    selectedCompanion = COMPANION_FINAL;

    await delay(pauseAfterFinalReveal);

    return COMPANION_FINAL;
  } finally {
    if (document.body.contains(slotMachine)) {
      document.body.removeChild(slotMachine);
    }
    document.body.classList.remove("slot-active");
  }
}

// ルーレット実行（同行者ルーレット統合版）
async function executeRoulette() {
  if (filteredRestaurants.length === 0) {
    alert("条件に合う店舗がありません。条件を変更してください。");
    return;
  }

  toggleButtons(false, "roulette");

  try {
    // 🆕 同行者チェックボックスの確認
    const companionToggle = document.getElementById("companionCheckbox");
    if (companionToggle && companionToggle.checked) {
      await runCompanionRoulette();
    } else {
      selectedCompanion = null;
      resetCompanionAnimation(true);
    }

    // 店舗を選択
    const randomIndex = Math.floor(Math.random() * filteredRestaurants.length);
    const selected = filteredRestaurants[randomIndex];

    displayResults([selected], true);

    const resultElement = document.getElementById("result");
    if (resultElement) {
      resultElement.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  } finally {
    toggleButtons(true, "roulette");
  }
}

// 結果を表示
function displayResults(restaurants, isRouletteResult = false) {
  const resultDiv = document.getElementById("result");
  if (!resultDiv) return;

  if (restaurants.length === 0) {
    resultDiv.innerHTML =
      '<p class="error">⚠️ 条件に合う店舗が見つかりませんでした。条件を変更してみてください。</p>';
    return;
  }

  resultDiv.innerHTML = "";

  restaurants.forEach((restaurant) => {
    const card = createRestaurantCard(restaurant, isRouletteResult);
    resultDiv.appendChild(card);
  });
}

// レストランカードを作成
function createRestaurantCard(restaurant, isHighlight = false) {
  const card = document.createElement("div");
  card.className = isHighlight
    ? "restaurant-card selected-restaurant"
    : "restaurant-card";

  let priceDisplay = "不明";
  let priceRangeDisplay = "";

  if (restaurant.priceLevel) {
    const priceInfo = getPriceInfo(restaurant.priceLevel);
    priceRangeDisplay = priceInfo.range;
  }

  const photoHTML = restaurant.photoUrl
    ? `<img src="${restaurant.photoUrl}" alt="${restaurant.name}" class="restaurant-photo" onerror="this.style.display='none'">`
    : '<div class="no-photo">📷 画像なし</div>';

  let openStatusHTML = "";
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

  let hoursDetailHTML = "";
  if (
    restaurant.openingHours &&
    restaurant.openingHours.weekdayTexts.length > 0
  ) {
    hoursDetailHTML = '<div class="opening-hours">';
    hoursDetailHTML += "<strong>📅 営業時間:</strong><br>";
    restaurant.openingHours.weekdayTexts.forEach((text) => {
      hoursDetailHTML += `<div class="opening-hours-detail">${text}</div>`;
    });
    hoursDetailHTML += "</div>";
  }

  card.innerHTML = `
    ${photoHTML}
    <div class="restaurant-info">
      <h3>${restaurant.name} ${openStatusHTML}</h3>
      <p>📍 ${restaurant.address}</p>
      <p>🚶 徒歩約${restaurant.travelTime}分 (${restaurant.distance}m)</p>
      <p>⭐ 評価: ${
        restaurant.rating ? restaurant.rating.toFixed(1) + " / 5.0" : "不明"
      }</p>
      <p>💰 価格帯: ${
        priceRangeDisplay
          ? `<span class="price-range">(${priceRangeDisplay})</span>`
          : ""
      }</p>
      ${hoursDetailHTML}
      ${
        isHighlight && selectedCompanion
          ? `<p class="companion-result-line">🤝 同行者: ${selectedCompanion.name}</p>`
          : ""
      }
      ${
        restaurant.googleMapsUri
          ? `<a href="${restaurant.googleMapsUri}" target="_blank" class="map-link">📍 地図で見る</a>`
          : ""
      }
    </div>
  `;

  return card;
}

// 価格レベルから価格帯情報を取得
function getPriceInfo(priceLevel) {
  const priceMap = {
    PRICE_LEVEL_FREE: {
      symbol: "無料",
      range: "",
    },
    PRICE_LEVEL_INEXPENSIVE: {
      symbol: "¥",
      range: "〜500円",
    },
    PRICE_LEVEL_MODERATE: {
      symbol: "¥¥",
      range: "500円〜1,000円",
    },
    PRICE_LEVEL_EXPENSIVE: {
      symbol: "¥¥¥",
      range: "1,000円〜2,000円",
    },
    PRICE_LEVEL_VERY_EXPENSIVE: {
      symbol: "¥¥¥¥",
      range: "2,000円〜",
    },
  };

  return priceMap[priceLevel] || { symbol: "不明", range: "" };
}

// 結果件数を更新
function updateResultCount() {
  const countElement = document.getElementById("resultCount");
  if (countElement) {
    if (filteredRestaurants.length > 0) {
      countElement.textContent = `🍽️ 条件に合う店舗: ${filteredRestaurants.length}件`;
    } else if (allRestaurants.length > 0) {
      countElement.textContent = "⚠️ 条件に合う店舗がありません";
    } else {
      countElement.textContent = "";
    }
  }
}

// ボタンの有効/無効を切り替え（context引数追加）
function toggleButtons(enabled, context = "all") {
  const searchBtn = document.getElementById("searchBtn");
  const rouletteBtn = document.getElementById("rouletteBtn");

  if (searchBtn && (context === "all" || context === "search")) {
    searchBtn.disabled = !enabled;
    searchBtn.textContent = enabled ? "🔍 条件で検索" : "検索中...";
  }

  if (rouletteBtn) {
    if (context === "search") {
      rouletteBtn.disabled = !enabled;
      if (enabled) {
        rouletteBtn.textContent = "🎲 ルーレットで決める！";
      }
    } else {
      rouletteBtn.disabled = !enabled;
      rouletteBtn.textContent = enabled
        ? "🎲 ルーレットで決める！"
        : "演出中...";
    }
  }
}

// 2地点間の距離を計算（Haversine公式）
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c);
}

// エラー表示
function showError(message) {
  const statusElement = document.getElementById("status");
  if (statusElement) {
    statusElement.innerHTML = `<div class="error">❌ ${message}</div>`;
  }
  console.error("Error:", message);
}
