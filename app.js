/* 
   Daily Sales Report System - Application Logic
   V2 Upgrade: Features role auth, dynamic Category CRUD, Excel imports/reconciliation,
   inline price override, EOD reconciliation, backup/restore, returns/voids, and activity logs.
*/

document.addEventListener("DOMContentLoaded", () => {
  // Initialize Lucide Icons
  lucide.createIcons();
  
  // App State
  let products = [];
  let transactions = [];
  let cart = [];
  let categories = [];
  let activityLog = [];
  let eodHistory = [];
  let currentUser = null;
  
  let activeTab = "dashboard";
  let html5QrcodeScanner = null;
  let activeCharts = {};
  let currentDiscount = { type: "amount", value: 0 };
  let isCloudflareDb = false;

  // Temp arrays for Excel uploads
  let tempImportData = [];
  let tempRestockData = [];
  let tempAuditData = [];
  let mismatchedRestockProducts = [];

  // --- AUTH SYSTEM ---
  const USERS_DB = {
    admin: { password: "ADM117@", name: "Admin", role: "admin" },
    cashier: { password: "CHR111@", name: "Cashier", role: "cashier" }
  };

  function checkLoginState() {
    const sessionUser = sessionStorage.getItem("smartsales_user");
    if (sessionUser) {
      currentUser = JSON.parse(sessionUser);
      applyLoginState();
    } else {
      showLoginScreen();
    }
  }

  function showLoginScreen() {
    document.getElementById("loginScreen").classList.remove("hidden");
    document.getElementById("appContainer").style.display = "none";
    document.getElementById("loginPassword").value = "";
    document.getElementById("loginError").textContent = "";
  }

  function applyLoginState() {
    document.getElementById("loginScreen").classList.add("hidden");
    document.getElementById("appContainer").style.display = "flex";
    
    // Update body classes for CSS role visibility rules
    const body = document.body;
    body.className = currentUser.role === "admin" ? "role-admin" : "role-cashier";

    // Set User Badge in sidebar
    const displayName = document.getElementById("userDisplayName");
    const roleLabel = document.getElementById("userRoleLabel");
    const avatar = document.getElementById("userAvatar");
    
    displayName.textContent = currentUser.name;
    roleLabel.textContent = currentUser.role === "admin" ? "ผู้ดูแลระบบ" : "แคชเชียร์";
    avatar.textContent = currentUser.role === "admin" ? "A" : "C";
    avatar.className = `user-badge-avatar ${currentUser.role}`;

    // Initialize System Data
    initData();
  }

  // Login Form Submission
  document.getElementById("loginForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const userSelect = document.getElementById("loginUsername");
    const passInput = document.getElementById("loginPassword");
    const errorEl = document.getElementById("loginError");
    const cardEl = document.getElementById("loginCard");
    
    const username = userSelect.value;
    const password = passInput.value;
    
    const user = USERS_DB[username];
    if (user && user.password === password) {
      currentUser = { username: username, name: user.name, role: user.role };
      sessionStorage.setItem("smartsales_user", JSON.stringify(currentUser));
      applyLoginState();
      
      logActivity("system", `เข้าสู่ระบบสำเร็จ (Role: ${user.role})`);
      showToast(`ยินดีต้อนรับคุณ ${user.name}!`);
    } else {
      playBeep("error");
      errorEl.textContent = "รหัสผ่านไม่ถูกต้อง!";
      cardEl.classList.add("shake");
      setTimeout(() => cardEl.classList.remove("shake"), 400);
    }
  });

  // Logout Handler
  document.getElementById("logoutBtn").addEventListener("click", () => {
    logActivity("system", "ออกจากระบบ");
    currentUser = null;
    sessionStorage.removeItem("smartsales_user");
    showLoginScreen();
    showToast("ออกจากระบบแล้ว", "warning");
  });

  // --- INITIALIZE SYSTEM DATA ---
  async function initData() {
    // Show a loading state on dashboard metrics
    document.getElementById("kpiRevenue").textContent = "กำลังโหลด...";
    document.getElementById("kpiProfit").textContent = "กำลังโหลด...";
    document.getElementById("kpiSalesCount").textContent = "...";
    
    try {
      // 1. Try to fetch from Cloudflare APIs
      const productsRes = await fetch("/api/products");
      if (productsRes.ok) {
        products = await productsRes.json();
        
        const transactionsRes = await fetch("/api/transactions");
        if (transactionsRes.ok) {
          transactions = await transactionsRes.json();
          isCloudflareDb = true;
          injectStatusBadge("online");
        }
      }
    } catch (e) {
      console.warn("API Connection failed. Falling back to LocalStorage.", e);
    }

    // 2. Fallback to LocalStorage if API fails
    if (!isCloudflareDb) {
      injectStatusBadge("offline");
      const storedProducts = localStorage.getItem("smartsales_products");
      const storedTransactions = localStorage.getItem("smartsales_transactions");

      if (storedProducts && storedTransactions) {
        products = JSON.parse(storedProducts);
        transactions = JSON.parse(storedTransactions);
      } else {
        // Use defaults from mockData.js
        products = [...window.DEFAULT_MOCK_DATA.products];
        transactions = [...window.DEFAULT_MOCK_DATA.transactions];
        saveLocalFallback();
      }
    }

    // Apply voided transactions from LocalStorage
    const voidedIds = JSON.parse(localStorage.getItem("smartsales_voided_txs") || "[]");
    transactions.forEach(t => {
      if (voidedIds.includes(t.id)) {
        t.voided = true;
      }
    });

    // 3. Load Extra V2 Data from LocalStorage
    // Categories
    const storedCats = localStorage.getItem("smartsales_categories");
    if (storedCats) {
      categories = JSON.parse(storedCats);
    } else {
      categories = [
        { key: "Beverages", name: "เครื่องดื่ม (Beverages)" },
        { key: "Snacks", name: "อาหารและขนม (Snacks)" },
        { key: "Electronics", name: "เครื่องใช้ไฟฟ้า & ไอที (Electronics)" },
        { key: "Stationery", name: "เครื่องเขียน (Stationery)" },
        { key: "Household", name: "ของใช้ในบ้าน (Household)" }
      ];
      localStorage.setItem("smartsales_categories", JSON.stringify(categories));
    }

    // Activity Log
    const storedLogs = localStorage.getItem("smartsales_activity_log");
    if (storedLogs) {
      activityLog = JSON.parse(storedLogs);
    } else {
      activityLog = [];
      localStorage.setItem("smartsales_activity_log", JSON.stringify(activityLog));
    }

    // EOD History
    const storedEod = localStorage.getItem("smartsales_eod_history");
    if (storedEod) {
      eodHistory = JSON.parse(storedEod);
    } else {
      eodHistory = [];
      localStorage.setItem("smartsales_eod_history", JSON.stringify(eodHistory));
    }
    
    // Set default date range filters in reports (last 7 days to today)
    const today = new Date();
    const lastWeek = new Date();
    lastWeek.setDate(today.getDate() - 6);
    
    document.getElementById("reportStartDate").value = lastWeek.toISOString().split("T")[0];
    document.getElementById("reportEndDate").value = today.toISOString().split("T")[0];
    
    // Set header date
    const options = { year: 'numeric', month: 'long', day: 'numeric', locale: 'th-TH' };
    document.getElementById("currentDateDisplay").textContent = today.toLocaleDateString('th-TH', options);
    
    // Render everything
    updateCategoryDropdowns();
    renderEODHistory();
    
    // Set initial active tab based on role
    if (currentUser.role === "admin") {
      switchTab("dashboard");
    } else {
      switchTab("pos");
    }
  }

  // Backup state to local storage (used as fallback or offline tracking)
  function saveLocalFallback() {
    localStorage.setItem("smartsales_products", JSON.stringify(products));
    localStorage.setItem("smartsales_transactions", JSON.stringify(transactions));
  }

  // Sync products with DB
  async function saveProductToDb(prod) {
    if (isCloudflareDb) {
      try {
        await fetch("/api/products", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(prod)
        });
      } catch (e) {
        console.error("Failed to sync product to Cloudflare D1", e);
      }
    }
    saveLocalFallback();
  }

  // Delete product from DB
  async function deleteProductFromDb(id) {
    if (isCloudflareDb) {
      try {
        await fetch(`/api/products?id=${id}`, {
          method: "DELETE"
        });
      } catch (e) {
        console.error("Failed to delete product from Cloudflare D1", e);
      }
    }
    saveLocalFallback();
  }

  // Inject Connection Status Badge in the header
  function injectStatusBadge(status) {
    const header = document.querySelector(".top-header");
    if (!header) return;
    
    const existing = document.getElementById("dbStatusBadge");
    if (existing) existing.remove();
    
    const badge = document.createElement("div");
    badge.id = "dbStatusBadge";
    badge.style.display = "flex";
    badge.style.alignItems = "center";
    badge.style.gap = "0.5rem";
    badge.style.fontSize = "0.8rem";
    badge.style.fontWeight = "600";
    badge.style.padding = "0.4rem 0.8rem";
    badge.style.borderRadius = "20px";
    badge.style.background = status === "online" ? "rgba(16, 185, 129, 0.1)" : "rgba(245, 158, 11, 0.1)";
    badge.style.border = status === "online" ? "1px solid rgba(16, 185, 129, 0.2)" : "1px solid rgba(245, 158, 11, 0.2)";
    badge.style.color = status === "online" ? "var(--success)" : "var(--warning)";
    badge.style.marginLeft = "auto";
    badge.style.marginRight = "1.5rem";
    
    const dot = document.createElement("span");
    dot.style.width = "8px";
    dot.style.height = "8px";
    dot.style.borderRadius = "50%";
    dot.style.background = status === "online" ? "var(--success)" : "var(--warning)";
    if (status === "online") {
      dot.style.boxShadow = "0 0 8px var(--success)";
      dot.style.animation = "pulse 2s infinite";
    }
    
    // Add pulsing keyframes if not present
    if (!document.getElementById("pulse-style")) {
      const style = document.createElement("style");
      style.id = "pulse-style";
      style.textContent = `
        @keyframes pulse {
          0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
          70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(16, 185, 129, 0); }
          100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
        }
      `;
      document.head.appendChild(style);
    }
    
    badge.appendChild(dot);
    const text = document.createElement("span");
    text.textContent = status === "online" ? "Cloudflare D1 (Online)" : "Local Storage (Offline)";
    badge.appendChild(text);
    
    const dateIndicator = document.querySelector(".date-indicator");
    header.insertBefore(badge, dateIndicator);
  }

  // --- AUDIO FEEDBACK HELPER ---
  function playBeep(type = "success") {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      if (type === "success") {
        osc.frequency.setValueAtTime(950, ctx.currentTime);
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        osc.start();
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);
        osc.stop(ctx.currentTime + 0.12);
      } else if (type === "error") {
        osc.frequency.setValueAtTime(220, ctx.currentTime);
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        osc.start();
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
        osc.stop(ctx.currentTime + 0.35);
      }
    } catch (e) {
      console.warn("Audio context suspended or blocked.", e);
    }
  }

  // --- TOAST NOTIFICATIONS ---
  function showToast(message, type = "success") {
    const container = document.getElementById("toastContainer");
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    
    let iconName = "check-circle";
    if (type === "warning") iconName = "alert-triangle";
    if (type === "error") iconName = "x-circle";
    
    toast.innerHTML = `
      <i data-lucide="${iconName}"></i>
      <span style="font-size: 0.85rem; font-weight:500;">${message}</span>
    `;
    
    container.appendChild(toast);
    lucide.createIcons({ attrs: { class: 'toast-icon-svg' } });
    
    setTimeout(() => {
      toast.style.animation = "fadeIn 0.3s ease reverse forwards";
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // --- SAFE BARCODE RENDERING WITH ERROR BOUNDARIES ---
  function safeRenderBarcode(selector, value, options = {}) {
    const defaults = {
      format: "EAN13",
      width: 1.25,
      height: 35,
      displayValue: false,
      margin: 2
    };
    const settings = { ...defaults, ...options };
    
    try {
      JsBarcode(selector, value, settings);
    } catch (e) {
      try {
        const code128Settings = { ...settings, format: "CODE128" };
        JsBarcode(selector, value, code128Settings);
      } catch (err) {
        console.error("Barcode rendering failed completely for selector:", selector, "value:", value, err);
        const svg = document.querySelector(selector);
        if (svg) {
          svg.style.display = "none";
          const errDiv = document.createElement("div");
          errDiv.style.color = "var(--danger)";
          errDiv.style.fontSize = "0.7rem";
          errDiv.style.fontWeight = "bold";
          errDiv.style.margin = "0.5rem 0";
          errDiv.textContent = "บาร์โค้ดไม่ถูกต้อง";
          svg.parentNode.insertBefore(errDiv, svg);
        }
      }
    }
  }

  // --- TAB NAVIGATION ---
  const navItems = document.querySelectorAll(".nav-item");
  navItems.forEach(item => {
    item.addEventListener("click", (e) => {
      e.preventDefault();
      const tabName = item.getAttribute("data-tab");
      // Role protection
      if (currentUser.role !== "admin" && (tabName === "dashboard" || tabName === "reports" || tabName === "activityLog")) {
        showToast("สิทธิ์การใช้งานจำกัดเฉพาะผู้ดูแลระบบ", "error");
        return;
      }
      switchTab(tabName);
    });
  });

  function switchTab(tabName) {
    activeTab = tabName;
    
    navItems.forEach(item => {
      if (item.getAttribute("data-tab") === tabName) {
        item.classList.add("active");
      } else {
        item.classList.remove("active");
      }
    });

    const panels = document.querySelectorAll(".view-panel");
    panels.forEach(panel => {
      if (panel.id === tabName) {
        panel.classList.add("active");
      } else {
        panel.classList.remove("active");
      }
    });

    const titleText = document.getElementById("pageTitleText");
    if (tabName === "dashboard") {
      titleText.textContent = "แดชบอร์ดสรุปยอดขาย";
      renderDashboard();
    } else if (tabName === "pos") {
      titleText.textContent = "จำลองเครื่องขายสินค้า (POS)";
      renderPOSCatalog();
      updateCartUI();
      setTimeout(() => document.getElementById("posBarcodeScanInput").focus(), 150);
    } else if (tabName === "catalog") {
      titleText.textContent = "คลังสินค้าและบาร์โค้ด";
      renderCatalogTable();
    } else if (tabName === "reports") {
      titleText.textContent = "รายงานยอดขายเชิงวิเคราะห์";
      renderSalesReportTable();
    } else if (tabName === "activityLog") {
      titleText.textContent = "บันทึกกิจกรรมในระบบ (Audit Trail)";
      renderActivityLogTable();
    }
  }

  function updateCategoryDropdowns() {
    const reportSelect = document.getElementById("reportCategorySelect");
    reportSelect.innerHTML = '<option value="All">ทั้งหมด</option>';
    
    const posTabs = document.getElementById("posCategoryTabs");
    posTabs.innerHTML = '<span class="category-tab active" data-category="All">ทั้งหมด</span>';

    const categorySelect = document.getElementById("formProductCategory");
    categorySelect.innerHTML = "";
    
    categories.forEach(cat => {
      const opt = document.createElement("option");
      opt.value = cat.key;
      opt.textContent = cat.name;
      reportSelect.appendChild(opt.cloneNode(true));
      categorySelect.appendChild(opt);
      
      const tab = document.createElement("span");
      tab.className = "category-tab";
      tab.setAttribute("data-category", cat.key);
      tab.textContent = cat.name;
      posTabs.appendChild(tab);
    });

    const tabs = posTabs.querySelectorAll(".category-tab");
    tabs.forEach(tab => {
      tab.addEventListener("click", () => {
        tabs.forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        renderPOSCatalog(tab.getAttribute("data-category"));
      });
    });
  }

  function getCategoryThaiName(catKey) {
    const cat = categories.find(c => c.key === catKey);
    return cat ? cat.name : catKey;
  }

  // Theme Toggler
  const themeToggleBtn = document.getElementById("themeToggleBtn");
  themeToggleBtn.addEventListener("click", () => {
    const currentTheme = document.documentElement.getAttribute("data-theme");
    const targetTheme = currentTheme === "dark" ? "light" : "dark";
    
    document.documentElement.setAttribute("data-theme", targetTheme);
    
    const icon = themeToggleBtn.querySelector("i");
    const label = themeToggleBtn.querySelector("span");
    
    if (targetTheme === "light") {
      icon.setAttribute("data-lucide", "moon");
      label.textContent = "สลับโหมดมืด";
    } else {
      icon.setAttribute("data-lucide", "sun");
      label.textContent = "สลับโหมดแสง";
    }
    lucide.createIcons();
    
    if (activeTab === "dashboard") {
      renderDashboard();
    }
  });

  // --- ACTIVITY LOGGER ---
  function logActivity(type, detail) {
    const user = currentUser ? currentUser.username : "guest";
    const role = currentUser ? currentUser.role : "guest";
    const entry = {
      timestamp: new Date().toISOString(),
      user: user,
      role: role,
      type: type, // 'sale', 'price-change', 'restock', 'audit', 'product', 'return', 'system'
      detail: detail
    };
    activityLog.push(entry);
    localStorage.setItem("smartsales_activity_log", JSON.stringify(activityLog));
    
    if (activeTab === "activityLog") {
      renderActivityLogTable();
    }
  }

  // --- DASHBOARD FUNCTIONS ---
  function renderDashboard() {
    const todayStr = new Date().toISOString().split("T")[0];
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split("T")[0];

    // Filter out voided transactions from dashboard KPIs and charts
    const todayTransactions = transactions.filter(t => t.timestamp.startsWith(todayStr) && !t.voided);
    const yesterdayTransactions = transactions.filter(t => t.timestamp.startsWith(yesterdayStr) && !t.voided);

    const todayRevenue = todayTransactions.reduce((sum, t) => sum + t.total, 0);
    const todayCost = todayTransactions.reduce((sum, t) => sum + t.totalCost, 0);
    const todayProfit = todayTransactions.reduce((sum, t) => sum + t.profit, 0);
    const todaySalesCount = todayTransactions.length;
    const todayMargin = todayRevenue > 0 ? (todayProfit / todayRevenue) * 100 : 0;

    const yesterdayRevenue = yesterdayTransactions.reduce((sum, t) => sum + t.total, 0);
    const yesterdayProfit = yesterdayTransactions.reduce((sum, t) => sum + t.profit, 0);
    const yesterdaySalesCount = yesterdayTransactions.length;

    document.getElementById("kpiRevenue").textContent = `฿${todayRevenue.toLocaleString("th-TH", { minimumFractionDigits: 2 })}`;
    document.getElementById("kpiProfit").textContent = `฿${todayProfit.toLocaleString("th-TH", { minimumFractionDigits: 2 })}`;
    document.getElementById("kpiSalesCount").textContent = todaySalesCount.toLocaleString("th-TH");
    document.getElementById("kpiMargin").textContent = `${todayMargin.toFixed(1)}%`;

    const revTrendEl = document.getElementById("kpiRevenueTrend");
    if (yesterdayRevenue > 0) {
      const diffPercent = ((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100;
      revTrendEl.className = diffPercent >= 0 ? "stat-trend up" : "stat-trend down";
      revTrendEl.innerHTML = `<i data-lucide="${diffPercent >= 0 ? "trending-up" : "trending-down"}"></i> <span>${diffPercent >= 0 ? "+" : ""}${diffPercent.toFixed(1)}% เทียบเมื่อวาน</span>`;
    } else {
      revTrendEl.className = "stat-trend neutral";
      revTrendEl.innerHTML = "<span>ไม่มีข้อมูลเมื่อวาน</span>";
    }

    const profitTrendEl = document.getElementById("kpiProfitTrend");
    if (yesterdayProfit > 0) {
      const diffPercent = ((todayProfit - yesterdayProfit) / yesterdayProfit) * 100;
      profitTrendEl.className = diffPercent >= 0 ? "stat-trend up" : "stat-trend down";
      profitTrendEl.innerHTML = `<i data-lucide="${diffPercent >= 0 ? "trending-up" : "trending-down"}"></i> <span>${diffPercent >= 0 ? "+" : ""}${diffPercent.toFixed(1)}% เทียบเมื่อวาน</span>`;
    } else {
      profitTrendEl.className = "stat-trend neutral";
      profitTrendEl.innerHTML = "<span>ไม่มีข้อมูลเมื่อวาน</span>";
    }

    const salesTrendEl = document.getElementById("kpiSalesTrend");
    const billDiff = todaySalesCount - yesterdaySalesCount;
    salesTrendEl.className = billDiff >= 0 ? "stat-trend up" : "stat-trend down";
    salesTrendEl.innerHTML = `<i data-lucide="${billDiff >= 0 ? "trending-up" : "trending-down"}"></i> <span>${billDiff >= 0 ? "+" : ""}${billDiff} บิล เทียบเมื่อวาน</span>`;

    lucide.createIcons();

    renderSalesTrendChart();
    renderTopProductsChart();
    renderPaymentMethodsChart();
    renderDashboardLowStock();
    renderEODHistory();
  }

  function renderSalesTrendChart() {
    const labels = [];
    const revenueData = [];
    const profitData = [];
    
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const dateStr = d.toISOString().split("T")[0];
      
      const labelText = d.toLocaleDateString("th-TH", { day: "numeric", month: "short" });
      labels.push(labelText);

      // Exclude voided
      const dailyTransactions = transactions.filter(t => t.timestamp.startsWith(dateStr) && !t.voided);
      const dailyRevenue = dailyTransactions.reduce((sum, t) => sum + t.total, 0);
      const dailyProfit = dailyTransactions.reduce((sum, t) => sum + t.profit, 0);

      revenueData.push(dailyRevenue);
      profitData.push(dailyProfit);
    }

    if (activeCharts.salesTrend) activeCharts.salesTrend.destroy();

    const ctx = document.getElementById("salesTrendChart").getContext("2d");
    const isDark = document.documentElement.getAttribute("data-theme") !== "light";
    const gridColor = isDark ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.06)";
    const textColor = isDark ? "#9ca3af" : "#475569";

    activeCharts.salesTrend = new Chart(ctx, {
      type: "line",
      data: {
        labels: labels,
        datasets: [
          {
            label: "ยอดขายสะสม (฿)",
            data: revenueData,
            borderColor: "#7c3aed",
            backgroundColor: "rgba(124, 58, 237, 0.1)",
            fill: true,
            tension: 0.3,
            borderWidth: 3,
            pointBackgroundColor: "#7c3aed"
          },
          {
            label: "กำไรสุทธิ (฿)",
            data: profitData,
            borderColor: "#10b981",
            backgroundColor: "rgba(16, 185, 129, 0.05)",
            fill: true,
            tension: 0.3,
            borderWidth: 2,
            pointBackgroundColor: "#10b981"
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: { color: textColor, font: { family: "Inter" } }
          }
        },
        scales: {
          x: {
            grid: { color: gridColor },
            ticks: { color: textColor, font: { family: "Inter" } }
          },
          y: {
            grid: { color: gridColor },
            ticks: { color: textColor, font: { family: "Inter" } }
          }
        }
      }
    });
  }

  function renderTopProductsChart() {
    const productSales = {};
    // Exclude voided
    transactions.filter(t => !t.voided).forEach(tx => {
      tx.items.forEach(item => {
        if (!productSales[item.name]) {
          productSales[item.name] = 0;
        }
        productSales[item.name] += item.quantity;
      });
    });

    const topProducts = Object.entries(productSales)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    const labels = topProducts.map(p => p[0]);
    const counts = topProducts.map(p => p[1]);

    if (activeCharts.topProducts) activeCharts.topProducts.destroy();

    const ctx = document.getElementById("topProductsChart").getContext("2d");
    const isDark = document.documentElement.getAttribute("data-theme") !== "light";
    const gridColor = isDark ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.06)";
    const textColor = isDark ? "#9ca3af" : "#475569";

    activeCharts.topProducts = new Chart(ctx, {
      type: "bar",
      data: {
        labels: labels,
        datasets: [{
          label: "จำนวนชิ้นที่ขายได้",
          data: counts,
          backgroundColor: [
            "rgba(6, 182, 212, 0.75)",
            "rgba(124, 58, 237, 0.75)",
            "rgba(16, 185, 129, 0.75)",
            "rgba(245, 158, 11, 0.75)",
            "rgba(239, 68, 68, 0.75)"
          ],
          borderWidth: 0,
          borderRadius: 6
        }]
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          x: {
            grid: { color: gridColor },
            ticks: { color: textColor, precision: 0 }
          },
          y: {
            grid: { display: false },
            ticks: { 
              color: textColor,
              callback: function(value) {
                const label = this.getLabelForValue(value);
                return label.length > 15 ? label.slice(0, 15) + "..." : label;
              }
            }
          }
        }
      }
    });
  }

  function renderPaymentMethodsChart() {
    const paymentSums = { "Cash": 0, "QR Code": 0, "Credit Card": 0 };
    // Exclude voided
    transactions.filter(t => !t.voided).forEach(t => {
      if (paymentSums[t.paymentMethod] !== undefined) {
        paymentSums[t.paymentMethod] += t.total;
      }
    });

    if (activeCharts.payment) activeCharts.payment.destroy();

    const ctx = document.getElementById("paymentMethodsChart").getContext("2d");
    const isDark = document.documentElement.getAttribute("data-theme") !== "light";
    const textColor = isDark ? "#9ca3af" : "#475569";

    activeCharts.payment = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: ["เงินสด (Cash)", "พร้อมเพย์ (QR)", "บัตรเครดิต (Card)"],
        datasets: [{
          data: [paymentSums["Cash"], paymentSums["QR Code"], paymentSums["Credit Card"]],
          backgroundColor: ["#10b981", "#06b6d4", "#7c3aed"],
          borderWidth: isDark ? 2 : 1,
          borderColor: isDark ? "#14151f" : "#ffffff"
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "right",
            labels: { color: textColor, font: { family: "Inter" } }
          }
        }
      }
    });
  }

  function renderDashboardLowStock() {
    const lowStockItems = products.filter(p => p.stock <= 10).sort((a,b) => a.stock - b.stock);
    const tbody = document.getElementById("dashboardLowStockTableBody");
    tbody.innerHTML = "";

    if (lowStockItems.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--success); font-weight:500;">✓ สินค้าทุกรายการมีสต็อกเพียงพอ</td></tr>';
      return;
    }

    lowStockItems.forEach(p => {
      const row = document.createElement("tr");
      
      let stockColor = "var(--warning)";
      let stockStatus = `${p.stock} ชิ้น (เหลือน้อย)`;
      
      if (p.stock === 0) {
        stockColor = "var(--danger)";
        stockStatus = "สินค้าหมด";
      }

      row.innerHTML = `
        <td class="barcode-cell">${p.barcode}</td>
        <td><strong>${p.name}</strong></td>
        <td>${getCategoryThaiName(p.category)}</td>
        <td>฿${p.price.toFixed(2)}</td>
        <td style="color: ${stockColor}; font-weight: bold;">${stockStatus}</td>
      `;
      tbody.appendChild(row);
    });
  }

  document.getElementById("viewCatalogFromDashboardBtn").addEventListener("click", () => {
    switchTab("catalog");
  });

  // --- POS FUNCTIONS ---
  function renderPOSCatalog(categoryFilter = "All") {
    const grid = document.getElementById("posProductGrid");
    const searchText = document.getElementById("posSearchProductInput").value.toLowerCase();
    
    grid.innerHTML = "";
    
    const filtered = products.filter(p => {
      const matchesCat = (categoryFilter === "All" || p.category === categoryFilter);
      const matchesSearch = p.name.toLowerCase().includes(searchText) || 
                            p.barcode.includes(searchText) || 
                            p.id.toLowerCase().includes(searchText);
      return matchesCat && matchesSearch;
    });

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; padding: 3rem 0; color: var(--text-muted);">
          <i data-lucide="package-search" style="width: 40px; height: 40px; margin-bottom: 0.5rem;"></i>
          <p>ไม่พบสินค้าตามเงื่อนไขที่เลือก</p>
        </div>
      `;
      lucide.createIcons();
      return;
    }

    filtered.forEach(p => {
      const card = document.createElement("div");
      card.className = "product-card";
      
      let stockClass = "in-stock";
      let stockLabel = `คงเหลือ ${p.stock}`;
      if (p.stock === 0) {
        stockClass = "out-stock";
        stockLabel = "สินค้าหมด";
      } else if (p.stock <= 10) {
        stockClass = "low-stock";
        stockLabel = `เหลือน้อย (${p.stock})`;
      }

      card.innerHTML = `
        <span class="stock-badge ${stockClass}">${stockLabel}</span>
        <div class="product-card-info">
          <span class="product-card-category">${getCategoryThaiName(p.category)}</span>
          <h4 class="product-card-name" title="${p.name}">${p.name}</h4>
          <span class="product-card-barcode"><i data-lucide="qr-code" style="width:12px; height:12px;"></i> ${p.barcode}</span>
        </div>
        <div class="product-card-price-row">
          <span class="product-card-price">฿${p.price.toFixed(2)}</span>
          <button class="add-card-btn"><i data-lucide="plus" style="width:16px; height:16px;"></i></button>
        </div>
      `;
      
      card.addEventListener("click", () => {
        addToCart(p);
      });
      
      grid.appendChild(card);
    });

    lucide.createIcons();
  }

  document.getElementById("posSearchProductInput").addEventListener("input", () => {
    const activeTabCat = document.querySelector("#posCategoryTabs .category-tab.active").getAttribute("data-category");
    renderPOSCatalog(activeTabCat);
  });

  const barcodeScanInput = document.getElementById("posBarcodeScanInput");
  barcodeScanInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const scannedBarcode = barcodeScanInput.value.trim();
      if (scannedBarcode) {
        const prod = products.find(p => p.barcode === scannedBarcode);
        if (prod) {
          addToCart(prod);
          barcodeScanInput.value = "";
        } else {
          playBeep("error");
          showToast(`ไม่พบบาร์โค้ด "${scannedBarcode}" ในระบบ!`, "error");
        }
      }
    }
  });

  function addToCart(product) {
    if (product.stock <= 0) {
      playBeep("error");
      showToast(`สินค้า "${product.name}" หมด! ไม่สามารถขายได้`, "error");
      return;
    }

    const existing = cart.find(item => item.product.id === product.id);
    
    if (existing) {
      if (existing.quantity + 1 > product.stock) {
        playBeep("error");
        showToast(`ในคลังมีสินค้าแค่ ${product.stock} ชิ้น เท่านั้น!`, "warning");
        return;
      }
      existing.quantity += 1;
    } else {
      cart.push({
        product: product,
        quantity: 1
      });
    }

    playBeep("success");
    updateCartUI();
  }

  function updateCartUI() {
    const cartContainer = document.getElementById("posCartItemsList");
    cartContainer.innerHTML = "";

    if (cart.length === 0) {
      cartContainer.innerHTML = `
        <div class="empty-cart-state" style="text-align: center; color: var(--text-muted); margin: auto; padding: 2rem 0;">
          <i data-lucide="shopping-bag" style="width: 48px; height: 48px; margin-bottom: 1rem; stroke-width: 1.5;"></i>
          <p style="font-size: 0.9rem;">ยังไม่มีสินค้าในตะกร้า</p>
          <p style="font-size: 0.75rem; margin-top: 0.25rem;">คลิกเลือกสินค้าหรือยิงบาร์โค้ดเพื่อเริ่มทำรายการ</p>
        </div>
      `;
      lucide.createIcons();
      
      document.getElementById("posSubtotal").textContent = "฿0.00";
      document.getElementById("posDiscount").textContent = "฿0.00";
      document.getElementById("posTax").textContent = "฿0.00";
      document.getElementById("posTotal").textContent = "฿0.00";
      document.getElementById("posCheckoutBtn").disabled = true;
      document.getElementById("posChangeText").textContent = "฿0.00";
      return;
    }

    let subtotal = 0;
    cart.forEach(item => {
      const price = item.overriddenPrice !== undefined ? item.overriddenPrice : item.product.price;
      const itemTotal = price * item.quantity;
      subtotal += itemTotal;

      const isPriceOverridden = item.overriddenPrice !== undefined;
      const originalPriceText = `฿${(item.product.price * item.quantity).toFixed(2)}`;
      const displayedPrice = isPriceOverridden 
        ? `<div class="price-override-container">
             <span class="price-original">${originalPriceText}</span>
             <span class="price-overridden" style="font-weight:700; color:var(--warning);">฿${itemTotal.toFixed(2)}</span>
           </div>`
        : `<span class="cart-item-total">฿${itemTotal.toFixed(2)}</span>`;

      const itemEl = document.createElement("div");
      itemEl.className = "cart-item";
      itemEl.innerHTML = `
        <div class="cart-item-info">
          <span class="cart-item-name" title="${item.product.name}">${item.product.name}</span>
          <button class="cart-item-remove-btn" data-id="${item.product.id}"><i data-lucide="trash-2" style="width:14px; height:14px;"></i></button>
        </div>
        <div class="cart-item-controls">
          <div class="qty-counter">
            <button class="qty-btn dec-btn" data-id="${item.product.id}">-</button>
            <span class="qty-val">${item.quantity}</span>
            <button class="qty-btn inc-btn" data-id="${item.product.id}">+</button>
          </div>
          <div class="price-override-wrapper" id="price-wrapper-${item.product.id}" style="display:flex; align-items:center; gap:0.4rem;">
            ${displayedPrice}
            <button class="price-edit-btn" data-id="${item.product.id}" title="ปรับเปลี่ยนราคาพิเศษสำหรับรายการนี้"><i data-lucide="pencil" style="width:12px; height:12px; vertical-align:middle;"></i></button>
          </div>
        </div>
      `;
      
      itemEl.querySelector(".dec-btn").addEventListener("click", () => updateQty(item.product.id, -1));
      itemEl.querySelector(".inc-btn").addEventListener("click", () => updateQty(item.product.id, 1));
      itemEl.querySelector(".cart-item-remove-btn").addEventListener("click", () => removeFromCart(item.product.id));
      
      // Inline Price Override Edit Click Listener
      itemEl.querySelector(".price-edit-btn").addEventListener("click", () => {
        const wrapper = document.getElementById(`price-wrapper-${item.product.id}`);
        const currentEditPrice = item.overriddenPrice !== undefined ? item.overriddenPrice : item.product.price;
        
        wrapper.innerHTML = `
          <div class="price-edit-inline">
            <input type="number" id="input-price-${item.product.id}" value="${currentEditPrice.toFixed(2)}" min="0.01" step="0.01">
            <button class="confirm-price" id="confirm-price-${item.product.id}" style="background:var(--success); color:white;"><i data-lucide="check" style="width:12px; height:12px;"></i></button>
            <button class="cancel-price" id="cancel-price-${item.product.id}" style="background:var(--danger); color:white;"><i data-lucide="x" style="width:12px; height:12px;"></i></button>
          </div>
        `;
        lucide.createIcons();
        
        document.getElementById(`confirm-price-${item.product.id}`).addEventListener("click", () => {
          const newPrice = parseFloat(document.getElementById(`input-price-${item.product.id}`).value);
          if (isNaN(newPrice) || newPrice <= 0) {
            showToast("กรุณากรอกราคาขายที่ถูกต้อง", "error");
            return;
          }
          item.overriddenPrice = newPrice;
          
          logActivity("price-change", `ปรับราคา POS ${item.product.name}: ฿${item.product.price.toFixed(2)} → ฿${newPrice.toFixed(2)}`);
          showToast(`ปรับราคาขายเป็น ฿${newPrice.toFixed(2)} แล้ว`);
          updateCartUI();
        });
        
        document.getElementById(`cancel-price-${item.product.id}`).addEventListener("click", () => {
          updateCartUI();
        });
      });

      cartContainer.appendChild(itemEl);
    });

    lucide.createIcons();

    let discountAmt = 0;
    if (currentDiscount.type === "amount") {
      discountAmt = currentDiscount.value;
    } else {
      discountAmt = subtotal * (currentDiscount.value / 100);
    }
    
    discountAmt = Math.min(discountAmt, subtotal);
    const total = subtotal - discountAmt;
    const taxAmt = total * 7 / 107;

    document.getElementById("posSubtotal").textContent = `฿${subtotal.toFixed(2)}`;
    document.getElementById("posDiscount").textContent = `฿${discountAmt.toFixed(2)}`;
    document.getElementById("posTax").textContent = `฿${taxAmt.toFixed(2)}`;
    document.getElementById("posTotal").textContent = `฿${total.toFixed(2)}`;
    document.getElementById("posCheckoutBtn").disabled = false;

    calculateChange();
  }

  function updateQty(productId, change) {
    const item = cart.find(item => item.product.id === productId);
    if (!item) return;

    const newQty = item.quantity + change;
    if (newQty <= 0) {
      removeFromCart(productId);
    } else if (newQty > item.product.stock) {
      playBeep("error");
      showToast(`ในคลังมีสินค้าเพียง ${item.product.stock} ชิ้น ไม่สามารถเพิ่มได้อีก!`, "warning");
    } else {
      item.quantity = newQty;
      updateCartUI();
    }
  }

  function removeFromCart(productId) {
    cart = cart.filter(item => item.product.id !== productId);
    updateCartUI();
    showToast("นำสินค้าออกจากตะกร้าเรียบร้อย");
  }

  document.getElementById("posClearCartBtn").addEventListener("click", () => {
    cart = [];
    currentDiscount = { type: "amount", value: 0 };
    updateCartUI();
    showToast("ล้างรายการในตะกร้าสำเร็จ", "warning");
  });

  const posAddDiscountBtn = document.getElementById("posAddDiscountBtn");
  const discountModal = document.getElementById("discountModal");
  const saveDiscountBtn = document.getElementById("saveDiscountBtn");
  
  posAddDiscountBtn.addEventListener("click", () => {
    document.getElementById("discountTypeSelect").value = currentDiscount.type;
    document.getElementById("discountValueInput").value = currentDiscount.value;
    openModal("discountModal");
  });

  saveDiscountBtn.addEventListener("click", () => {
    const type = document.getElementById("discountTypeSelect").value;
    const val = parseFloat(document.getElementById("discountValueInput").value) || 0;
    
    if (val < 0) {
      showToast("กรุณาใส่ส่วนลดมากกว่าหรือเท่ากับ 0", "error");
      return;
    }
    
    currentDiscount = { type: type, value: val };
    closeModal("discountModal");
    updateCartUI();
    showToast("บันทึกส่วนลดเรียบร้อย");
  });

  const paymentMethodSelect = document.getElementById("posPaymentMethodSelect");
  const cashDetailsBlock = document.getElementById("posCashDetailsBlock");
  const cashReceivedInput = document.getElementById("posCashReceivedInput");

  paymentMethodSelect.addEventListener("change", () => {
    const val = paymentMethodSelect.value;
    if (val === "Cash") {
      cashDetailsBlock.style.display = "block";
      cashReceivedInput.required = true;
    } else {
      cashDetailsBlock.style.display = "none";
      cashReceivedInput.required = false;
      cashReceivedInput.value = "";
    }
    calculateChange();
  });

  cashReceivedInput.addEventListener("input", calculateChange);

  const quickCashButtons = document.querySelectorAll(".pos-quick-cash-btn");
  quickCashButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const val = parseFloat(btn.getAttribute("data-value"));
      const currentVal = parseFloat(cashReceivedInput.value) || 0;
      cashReceivedInput.value = currentVal + val;
      calculateChange();
    });
  });

  function calculateChange() {
    const totalText = document.getElementById("posTotal").textContent.replace("฿", "").replace(/,/g, "");
    const total = parseFloat(totalText) || 0;
    const changeText = document.getElementById("posChangeText");
    const checkoutBtn = document.getElementById("posCheckoutBtn");
    
    if (paymentMethodSelect.value !== "Cash") {
      changeText.textContent = "฿0.00";
      changeText.style.color = "var(--success)";
      checkoutBtn.disabled = cart.length === 0;
      return;
    }

    const cashReceived = parseFloat(cashReceivedInput.value) || 0;
    const change = cashReceived - total;

    if (change >= 0) {
      changeText.textContent = `฿${change.toFixed(2)}`;
      changeText.style.color = "var(--success)";
      checkoutBtn.disabled = false;
    } else {
      changeText.textContent = `฿0.00`;
      changeText.style.color = "var(--danger)";
      checkoutBtn.disabled = true;
    }
  }

  // CHECKOUT TRIGGER
  const posCheckoutBtn = document.getElementById("posCheckoutBtn");
  posCheckoutBtn.addEventListener("click", executeCheckout);

  window.addEventListener("keydown", (e) => {
    if (activeTab === "pos" && e.key === "F8") {
      e.preventDefault();
      if (!posCheckoutBtn.disabled) {
        executeCheckout();
      }
    }
  });

  async function executeCheckout() {
    if (cart.length === 0) return;

    // Loading overlay checkout indicator
    posCheckoutBtn.disabled = true;
    posCheckoutBtn.textContent = "กำลังดำเนินการ...";

    const subtotalText = document.getElementById("posSubtotal").textContent.replace("฿", "").replace(/,/g, "");
    const discountText = document.getElementById("posDiscount").textContent.replace("฿", "").replace(/,/g, "");
    const totalText = document.getElementById("posTotal").textContent.replace("฿", "").replace(/,/g, "");
    const taxText = document.getElementById("posTax").textContent.replace("฿", "").replace(/,/g, "");
    
    const subtotal = parseFloat(subtotalText);
    const discount = parseFloat(discountText);
    const total = parseFloat(totalText);
    const tax = parseFloat(taxText);
    
    const paymentMethod = paymentMethodSelect.value;
    const cashReceived = paymentMethod === "Cash" ? (parseFloat(cashReceivedInput.value) || 0) : 0;
    const change = paymentMethod === "Cash" ? (cashReceived - total) : 0;
    
    let totalCost = 0;
    const txItems = cart.map(item => {
      const price = item.overriddenPrice !== undefined ? item.overriddenPrice : item.product.price;
      totalCost += item.product.cost * item.quantity;
      return {
        productId: item.product.id,
        name: item.product.name,
        barcode: item.product.barcode,
        category: item.product.category,
        price: price,
        cost: item.product.cost,
        quantity: item.quantity,
        totalPrice: price * item.quantity,
        totalCost: item.product.cost * item.quantity
      };
    });

    const nextTxNum = transactions.length > 0 
      ? parseInt(transactions[transactions.length - 1].id.replace("TX", "")) + 1 
      : 10001;
      
    const newTransaction = {
      id: `TX${nextTxNum}`,
      timestamp: new Date().toISOString(),
      items: txItems,
      subtotal: subtotal,
      discount: discount,
      tax: tax,
      total: total,
      totalCost: totalCost,
      profit: total - totalCost,
      paymentMethod: paymentMethod,
      cashReceived: cashReceived,
      change: change
    };

    let checkoutSuccessful = false;

    if (isCloudflareDb) {
      try {
        // API Checkout
        const res = await fetch("/api/transactions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(newTransaction)
        });
        if (res.ok) {
          checkoutSuccessful = true;
          // Decrement local inventory stock representation
          cart.forEach(item => {
            const p = products.find(prod => prod.id === item.product.id);
            if (p) p.stock = Math.max(0, p.stock - item.quantity);
          });
          transactions.push(newTransaction);
        } else {
          const err = await res.json();
          showToast(`เกิดข้อผิดพลาดในการบันทึก: ${err.error}`, "error");
        }
      } catch (err) {
        showToast("ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ในการบันทึกยอดขายได้", "error");
      }
    } else {
      // Local Fallback
      cart.forEach(item => {
        const p = products.find(prod => prod.id === item.product.id);
        if (p) p.stock = Math.max(0, p.stock - item.quantity);
      });
      transactions.push(newTransaction);
      saveLocalFallback();
      checkoutSuccessful = true;
    }

    // Reset button values
    posCheckoutBtn.innerHTML = '<i data-lucide="badge-check"></i> <span>ชำระเงิน & พิมพ์ใบเสร็จ (F8)</span>';
    lucide.createIcons();

    if (checkoutSuccessful) {
      populateReceipt(newTransaction);
      
      cart = [];
      currentDiscount = { type: "amount", value: 0 };
      cashReceivedInput.value = "";
      
      playBeep("success");
      showToast("ชำระเงินและตัดสต็อกสำเร็จ!");
      
      updateCartUI();
      renderPOSCatalog();
      
      logActivity("sale", `ขายสินค้าบิล ${newTransaction.id} ยอดเงิน ฿${total.toFixed(2)} (${paymentMethod})`);
      
      openModal("receiptModal");
    } else {
      playBeep("error");
      posCheckoutBtn.disabled = false;
    }
  }

  function populateReceipt(tx) {
    document.getElementById("receiptTxId").textContent = tx.id;
    
    const d = new Date(tx.timestamp);
    const dateFormatted = d.toLocaleDateString("th-TH") + " " + d.toLocaleTimeString("th-TH");
    document.getElementById("receiptTimestamp").textContent = dateFormatted;
    document.getElementById("receiptCashierName").textContent = currentUser ? currentUser.name.toUpperCase() : "CASHIER";

    const container = document.getElementById("receiptItemsContainer");
    container.innerHTML = "";
    tx.items.forEach(item => {
      const row = document.createElement("div");
      row.className = "receipt-item-row";
      row.innerHTML = `
        <div class="receipt-item-main">
          <span>${item.name}</span>
          <span>฿${item.totalPrice.toFixed(2)}</span>
        </div>
        <div class="receipt-item-sub">
          <span>${item.quantity} ชิ้น x ฿${item.price.toFixed(2)}</span>
        </div>
      `;
      container.appendChild(row);
    });

    document.getElementById("receiptSubtotal").textContent = `฿${tx.subtotal.toFixed(2)}`;
    document.getElementById("receiptDiscount").textContent = `฿${tx.discount.toFixed(2)}`;
    document.getElementById("receiptTax").textContent = `฿${tx.tax.toFixed(2)}`;
    document.getElementById("receiptGrandTotal").textContent = `฿${tx.total.toFixed(2)}`;

    document.getElementById("receiptPaymentMethod").textContent = getPaymentThaiName(tx.paymentMethod);
    const cashBlock = document.getElementById("receiptCashExchangeBlock");
    
    if (tx.paymentMethod === "Cash") {
      cashBlock.style.display = "block";
      document.getElementById("receiptCashReceived").textContent = `฿${tx.cashReceived.toFixed(2)}`;
      document.getElementById("receiptChange").textContent = `฿${tx.change.toFixed(2)}`;
    } else {
      cashBlock.style.display = "none";
    }

    JsBarcode("#receiptBarcodeSvg", tx.id, {
      format: "CODE39",
      width: 1.5,
      height: 35,
      displayValue: true,
      fontSize: 10,
      margin: 2
    });
  }

  function getPaymentThaiName(method) {
    const dict = {
      "Cash": "เงินสด (CASH)",
      "QR Code": "พร้อมเพย์ (PROMPTPAY QR)",
      "Credit Card": "บัตรเครดิต (CREDIT CARD)"
    };
    return dict[method] || method;
  }

  // --- CAMERA SCANNERS WORK ---
  const posCameraScanBtn = document.getElementById("posCameraScanBtn");
  
  posCameraScanBtn.addEventListener("click", () => {
    openModal("cameraScannerModal");
    startCameraScanner();
  });

  function startCameraScanner() {
    html5QrcodeScanner = new Html5Qrcode("reader");
    const config = { fps: 15, qrbox: { width: 220, height: 120 } };

    html5QrcodeScanner.start(
      { facingMode: "environment" },
      config,
      onScanSuccess,
      onScanError
    ).catch(err => {
      console.error("Camera access failure", err);
      showToast("ไม่สามารถเปิดกล้องได้ หรือสิทธิ์การเข้าถึงกล้องถูกปฏิเส์", "error");
      closeModal("cameraScannerModal");
    });
  }

  let lastScannedCode = "";
  let lastScannedTime = 0;

  function onScanSuccess(decodedText, decodedResult) {
    const now = Date.now();
    if (decodedText === lastScannedCode && (now - lastScannedTime) < 1500) {
      return;
    }

    lastScannedCode = decodedText;
    lastScannedTime = now;

    const prod = products.find(p => p.barcode === decodedText);
    if (prod) {
      addToCart(prod);
      showToast(`สแกนเจอ: ${prod.name}`, "success");
      
      const overlay = document.querySelector(".scanner-overlay");
      overlay.style.backgroundColor = "rgba(16, 185, 129, 0.2)";
      setTimeout(() => overlay.style.backgroundColor = "transparent", 300);
    } else {
      playBeep("error");
      showToast(`ไม่พบบาร์โค้ด "${decodedText}" ในระบบ!`, "error");
      
      const overlay = document.querySelector(".scanner-overlay");
      overlay.style.backgroundColor = "rgba(239, 68, 68, 0.2)";
      setTimeout(() => overlay.style.backgroundColor = "transparent", 300);
    }
  }

  function onScanError(errorMessage) {}

  // Stop Camera
  function stopCameraScanner() {
    if (html5QrcodeScanner && html5QrcodeScanner.isScanning) {
      html5QrcodeScanner.stop().then(() => {
        html5QrcodeScanner = null;
      }).catch(err => {
        console.error("Stop camera error", err);
      });
    }
  }

  // --- PRODUCT CATALOG MANAGEMENT ---
  function renderCatalogTable() {
    const tbody = document.getElementById("catalogTableBody");
    const searchText = document.getElementById("catalogSearchInput").value.toLowerCase();
    
    tbody.innerHTML = "";

    const filtered = products.filter(p => {
      return p.name.toLowerCase().includes(searchText) || 
             p.barcode.includes(searchText) || 
             p.category.toLowerCase().includes(searchText) ||
             p.id.toLowerCase().includes(searchText);
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" style="text-align: center; color: var(--text-muted); padding: 2rem;">
            ไม่มีข้อมูลสินค้าในระบบตามคำค้นหาที่กรอก
          </td>
        </tr>
      `;
      return;
    }

    filtered.forEach(p => {
      const row = document.createElement("tr");
      
      let stockColor = "var(--success)";
      let stockStatus = "มีสินค้า";
      if (p.stock === 0) {
        stockColor = "var(--danger)";
        stockStatus = "สินค้าหมด";
      } else if (p.stock <= 10) {
        stockColor = "var(--warning)";
        stockStatus = "เหลือน้อย";
      }

      row.innerHTML = `
        <td style="font-family: monospace; font-weight: bold;">${p.id}</td>
        <td class="barcode-cell" style="cursor: pointer; color: var(--accent-primary);" title="คลิกเพื่อพิมพ์บาร์โค้ด">
          <i data-lucide="qr-code" style="width:14px; height:14px; vertical-align:-2px; margin-right:4px;"></i>
          ${p.barcode}
        </td>
        <td><strong>${p.name}</strong></td>
        <td>${getCategoryThaiName(p.category)}</td>
        <td style="text-align: right; font-family: monospace;">฿${p.cost.toFixed(2)}</td>
        <td style="text-align: right; font-family: monospace; font-weight: 600; color: var(--accent-secondary);">฿${p.price.toFixed(2)}</td>
        <td style="text-align: center; font-weight: 600; font-family: monospace;">${p.stock}</td>
        <td style="text-align: center;">
          <span style="color: ${stockColor}; font-weight: bold; font-size: 0.8rem;">${stockStatus}</span>
        </td>
        <td style="text-align: center;">
          <button class="btn btn-secondary btn-sm edit-prod-btn" data-id="${p.id}" style="padding: 0.3rem 0.5rem; display: inline-flex;"><i data-lucide="edit-3" style="width:12px; height:12px;"></i></button>
          ${currentUser.role === "admin" ? `<button class="btn btn-secondary btn-sm delete-prod-btn" data-id="${p.id}" style="padding: 0.3rem 0.5rem; display: inline-flex; color: var(--danger);"><i data-lucide="trash-2" style="width:12px; height:12px;"></i></button>` : ""}
        </td>
      `;

      row.querySelector(".barcode-cell").addEventListener("click", () => openBarcodeLabelPopup(p));
      row.querySelector(".edit-prod-btn").addEventListener("click", () => editProductForm(p.id));
      
      if (currentUser.role === "admin") {
        row.querySelector(".delete-prod-btn").addEventListener("click", () => deleteProduct(p.id));
      }

      tbody.appendChild(row);
    });

    lucide.createIcons();
  }

  document.getElementById("catalogSearchInput").addEventListener("input", renderCatalogTable);

  function openBarcodeLabelPopup(prod) {
    const modal = document.getElementById("barcodeLabelsModal");
    modal.querySelector("h3").textContent = "บาร์โค้ดสินค้า";
    modal.querySelector(".print-instruction-text").textContent = `รหัสบาร์โค้ด EAN-13 ของสินค้า: ${prod.name}`;

    const container = document.getElementById("barcodeLabelsContainer");
    container.innerHTML = `
      <div class="barcode-sticker">
        <span class="product-name">${prod.name}</span>
        <svg id="singleBarcodeSvg"></svg>
        <span style="font-family: monospace; font-size: 0.8rem; margin-top: 0.2rem; font-weight: bold;">${prod.barcode}</span>
        <span style="font-family: Outfit; font-size: 0.95rem; font-weight: 800; color: var(--accent-secondary); margin-top:0.15rem;">฿${prod.price.toFixed(2)}</span>
      </div>
    `;

    openModal("barcodeLabelsModal");
    
    safeRenderBarcode("#singleBarcodeSvg", prod.barcode, {
      format: "EAN13",
      width: 1.8,
      height: 48,
      displayValue: false,
      margin: 4
    });
  }

  // Single Add Product Button
  document.getElementById("catalogAddProductBtn").addEventListener("click", () => {
    document.getElementById("productForm").reset();
    document.getElementById("formProductId").value = "";
    document.getElementById("productModalTitle").textContent = "เพิ่มสินค้าใหม่";
    
    // Enable stock field for new product
    document.getElementById("formProductStock").disabled = false;
    
    openModal("productFormModal");
  });

  // Edit Product Click
  function editProductForm(id) {
    const p = products.find(prod => prod.id === id);
    if (!p) return;

    document.getElementById("formProductId").value = p.id;
    document.getElementById("formProductName").value = p.name;
    document.getElementById("formProductBarcode").value = p.barcode;
    document.getElementById("formProductCategory").value = p.category;
    document.getElementById("formProductCost").value = p.cost;
    document.getElementById("formProductPrice").value = p.price;
    document.getElementById("formProductStock").value = p.stock;
    
    // Disable stock field on edit (stock should be modified via Restock/Audit or checkout only)
    document.getElementById("formProductStock").disabled = true;

    document.getElementById("productModalTitle").textContent = `แก้ไขข้อมูลสินค้า [${p.id}]`;
    openModal("productFormModal");
  }

  // Product Form Submit Handler
  document.getElementById("productForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("formProductId").value;
    const name = document.getElementById("formProductName").value.trim();
    const barcode = document.getElementById("formProductBarcode").value.trim();
    const category = document.getElementById("formProductCategory").value;
    const cost = parseFloat(document.getElementById("formProductCost").value);
    const price = parseFloat(document.getElementById("formProductPrice").value);
    const stock = parseInt(document.getElementById("formProductStock").value) || 0;

    if (cost < 0 || price < 0 || stock < 0) {
      showToast("ราคาทุน ราคาขาย และจำนวนสต็อกห้ามติดลบ!", "error");
      return;
    }

    const dupBarcode = products.some(p => p.barcode === barcode && p.id !== id);
    if (dupBarcode) {
      playBeep("error");
      showToast(`รหัสบาร์โค้ด "${barcode}" มีอยู่ในระบบแล้ว!`, "error");
      return;
    }

    const prodData = { id, name, barcode, category, price, cost, stock };
    let isNew = !id;

    if (isNew) {
      let maxNum = 0;
      products.forEach(p => {
        const num = parseInt(p.id.replace("P", ""));
        if (!isNaN(num) && num > maxNum) maxNum = num;
      });
      prodData.id = "P" + String(maxNum + 1).padStart(3, "0");
      products.push(prodData);
    } else {
      const idx = products.findIndex(p => p.id === id);
      if (idx !== -1) {
        prodData.stock = products[idx].stock; // keep system stock unchanged on basic edit
        products[idx] = prodData;
      }
    }

    await saveProductToDb(prodData);
    
    logActivity("product", `${isNew ? "เพิ่มสินค้าใหม่" : "แก้ไขข้อมูล"} SKU: ${prodData.id}, Name: ${prodData.name}, Cost: ฿${cost}, Price: ฿${price}`);
    showToast(isNew ? "บันทึกสินค้าใหม่สำเร็จ!" : "แก้ไขข้อมูลสินค้าเรียบร้อย");
    closeModal("productFormModal");
    renderCatalogTable();
    renderPOSCatalog();
    renderDashboard();
  });

  // Delete Product handler
  async function deleteProduct(id) {
    if (currentUser.role !== "admin") {
      playBeep("error");
      showToast("สิทธิ์ลบสินค้าจำกัดเฉพาะผู้ดูแลระบบ", "error");
      return;
    }

    const p = products.find(prod => prod.id === id);
    if (!p) return;

    if (confirm(`คุณแน่ใจว่าต้องการลบสินค้า "${p.name}" ออกจากระบบถาวร?`)) {
      products = products.filter(prod => prod.id !== id);
      await deleteProductFromDb(id);
      
      logActivity("product", `ลบข้อมูลสินค้า SKU: ${id}, Name: ${p.name}`);
      showToast(`ลบสินค้า "${p.name}" สำเร็จ!`, "warning");
      renderCatalogTable();
      renderPOSCatalog();
      renderDashboard();
    }
  }

  // Random Barcode Generator Utility inside modal
  document.getElementById("formGenerateRandomBarcodeBtn").addEventListener("click", () => {
    let rand = "885";
    for (let i = 0; i < 10; i++) {
      rand += Math.floor(Math.random() * 10);
    }
    document.getElementById("formProductBarcode").value = rand;
    showToast("สุ่มบาร์โค้ด 13 หลักสำเร็จ!");
  });

  // Print Barcode Sheet Modal Handler
  document.getElementById("catalogPrintSheetBtn").addEventListener("click", () => {
    const modal = document.getElementById("barcodeLabelsModal");
    modal.querySelector("h3").textContent = "แผ่นป้ายบาร์โค้ดทั้งหมด (Barcode Sticker Sheets)";
    modal.querySelector(".print-instruction-text").textContent = "แผ่นป้ายสติกเกอร์จำลองสำหรับสินค้าทุกรายการในระบบ เพื่อใช้ทดสอบการยิงหรือสแกนผ่านกล้อง";

    const container = document.getElementById("barcodeLabelsContainer");
    container.innerHTML = "";
    
    products.forEach(p => {
      const sticker = document.createElement("div");
      sticker.className = "barcode-sticker";
      sticker.innerHTML = `
        <span class="product-name" style="font-weight: 700;">${p.name}</span>
        <svg id="sheetBarcodeSvg-${p.id}"></svg>
        <span style="font-family: monospace; font-size: 0.72rem; margin-top: 0.2rem; font-weight: bold;">${p.barcode}</span>
        <span style="font-family: Outfit; font-size: 0.85rem; font-weight: bold; color: var(--accent-secondary); margin-top:0.15rem;">฿${p.price.toFixed(2)}</span>
      `;
      container.appendChild(sticker);
      
      safeRenderBarcode(`#sheetBarcodeSvg-${p.id}`, p.barcode, {
        format: "EAN13",
        width: 1.1,
        height: 25,
        displayValue: false,
        margin: 2
      });
    });

    openModal("barcodeLabelsModal");
  });

  // --- CATEGORY CRUD MANAGEMENT ---
  document.getElementById("catalogManageCategoryBtn").addEventListener("click", () => {
    renderCategoryManagerList();
    openModal("categoryManagerModal");
  });

  function renderCategoryManagerList() {
    const list = document.getElementById("categoryList");
    list.innerHTML = "";
    
    categories.forEach(cat => {
      const count = products.filter(p => p.category === cat.key).length;
      const li = document.createElement("li");
      li.className = "category-list-item";
      li.innerHTML = `
        <div class="cat-info">
          <span class="cat-name">${cat.name}</span>
          <span class="cat-count">${count} รายการสินค้า</span>
        </div>
        <button class="cat-delete-btn" data-key="${cat.key}"><i data-lucide="trash-2" style="width:16px; height:16px;"></i></button>
      `;
      
      li.querySelector(".cat-delete-btn").addEventListener("click", () => {
        deleteCategory(cat.key);
      });
      list.appendChild(li);
    });
    lucide.createIcons();
  }

  function deleteCategory(key) {
    const count = products.filter(p => p.category === key).length;
    if (count > 0) {
      playBeep("error");
      showToast(`ไม่สามารถลบหมวดหมู่ "${getCategoryThaiName(key)}" ได้เนื่องจากยังมีสินค้าอยู่ ${count} รายการ!`, "error");
      return;
    }

    if (categories.length <= 1) {
      showToast("ต้องมีหมวดหมู่สินค้าในระบบอย่างน้อย 1 รายการ", "error");
      return;
    }

    if (confirm(`ยืนยันลบหมวดหมู่ "${getCategoryThaiName(key)}" ใช่หรือไม่?`)) {
      categories = categories.filter(c => c.key !== key);
      localStorage.setItem("smartsales_categories", JSON.stringify(categories));
      
      logActivity("system", `ลบหมวดหมู่สินค้า: ${key}`);
      showToast("ลบหมวดหมู่สำเร็จแล้ว");
      
      renderCategoryManagerList();
      updateCategoryDropdowns();
      renderPOSCatalog();
      renderCatalogTable();
    }
  }

  document.getElementById("addCategoryBtn").addEventListener("click", () => {
    const keyInput = document.getElementById("newCategoryKey");
    const nameInput = document.getElementById("newCategoryName");
    const key = keyInput.value.trim();
    const name = nameInput.value.trim();

    if (!key || !name) {
      showToast("กรุณากรอก Key และชื่อหมวดหมู่ให้ครบถ้วน", "error");
      return;
    }

    // Key Validation (Alphanumeric english only)
    if (!/^[a-zA-Z0-9_-]+$/.test(key)) {
      showToast("Key ของหมวดหมู่ต้องเป็นภาษาอังกฤษหรือตัวเลขเท่านั้น (ห้ามเว้นวรรค)", "error");
      return;
    }

    if (categories.some(c => c.key.toLowerCase() === key.toLowerCase())) {
      showToast("มีรหัส Key หมวดหมู่นี้อยู่ในระบบแล้ว", "error");
      return;
    }

    categories.push({ key: key, name: name });
    localStorage.setItem("smartsales_categories", JSON.stringify(categories));

    logActivity("system", `เพิ่มหมวดหมู่สินค้าใหม่: ${name} (${key})`);
    showToast("เพิ่มหมวดหมู่สินค้าสำเร็จ!");

    keyInput.value = "";
    nameInput.value = "";

    renderCategoryManagerList();
    updateCategoryDropdowns();
    renderPOSCatalog();
    renderCatalogTable();
  });

  // --- SHEETJS EXCEL IMPORTS & AUDITS ---
  // Setup file drag and drop helper
  function setupDragAndDrop(zoneId, fileInputId, type) {
    const zone = document.getElementById(zoneId);
    const input = document.getElementById(fileInputId);
    
    zone.addEventListener("click", () => input.click());
    
    zone.addEventListener("dragover", (e) => {
      e.preventDefault();
      zone.style.borderColor = "var(--accent-primary)";
      zone.style.background = "rgba(var(--accent-primary-rgb), 0.05)";
    });
    
    zone.addEventListener("dragleave", () => {
      zone.style.borderColor = "var(--border-glass)";
      zone.style.background = "rgba(var(--accent-primary-rgb), 0.01)";
    });
    
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      zone.style.borderColor = "var(--border-glass)";
      zone.style.background = "rgba(var(--accent-primary-rgb), 0.01)";
      
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        input.files = files;
        handleExcelImport(files[0], type);
      }
    });
    
    input.addEventListener("change", (e) => {
      const files = e.target.files;
      if (files.length > 0) {
        handleExcelImport(files[0], type);
      }
    });
  }

  setupDragAndDrop("bulkImportDropZone", "bulkImportFileInput", "import");
  setupDragAndDrop("restockDropZone", "restockFileInput", "restock");
  setupDragAndDrop("stockAuditDropZone", "stockAuditFileInput", "audit");

  function handleExcelImport(file, type) {
    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const json = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        if (type === 'import') {
          processBulkImportJSON(json);
        } else if (type === 'restock') {
          processRestockJSON(json);
        } else if (type === 'audit') {
          processAuditJSON(json);
        }
      } catch (err) {
        showToast("ไม่สามารถประมวลผลไฟล์ Excel ได้", "error");
        console.error(err);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  // 1. Bulk Add Products from Excel
  document.getElementById("catalogBulkImportBtn").addEventListener("click", () => {
    document.getElementById("bulkImportPreview").style.display = "none";
    document.getElementById("bulkImportConfirmBtn").disabled = true;
    document.getElementById("bulkImportFileInput").value = "";
    openModal("bulkImportModal");
  });

  document.getElementById("bulkImportDownloadTemplateBtn").addEventListener("click", () => {
    const data = [
      ["barcode", "name", "category", "cost", "price", "stock"],
      ["8850999111101", "โค้ก ออริจินัล 325มล", "Beverages", 10.00, 15.00, 120],
      ["8850999111118", "น้ำดื่ม สิงห์ 600มล", "Beverages", 6.00, 10.00, 85]
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Products Template");
    XLSX.writeFile(wb, "products_bulk_import_template.xlsx");
    showToast("ดาวน์โหลด Template เรียบร้อย");
  });

  function processBulkImportJSON(rows) {
    if (rows.length < 2) {
      showToast("ไฟล์ Excel ไม่มีข้อมูล", "error");
      return;
    }

    const headers = rows[0].map(h => String(h || "").trim().toLowerCase());
    const barcodeIdx = headers.indexOf("barcode");
    const nameIdx = headers.indexOf("name");
    const categoryIdx = headers.indexOf("category");
    const costIdx = headers.indexOf("cost");
    const priceIdx = headers.indexOf("price");
    const stockIdx = headers.indexOf("stock");

    if (barcodeIdx === -1 || nameIdx === -1 || categoryIdx === -1 || costIdx === -1 || priceIdx === -1 || stockIdx === -1) {
      showToast("โครงสร้างไฟล์ไม่ถูกต้อง (กรุณาใช้ Template ที่ดาวน์โหลดจากระบบ)", "error");
      return;
    }

    tempImportData = [];
    const tbody = document.getElementById("bulkImportPreviewBody");
    tbody.innerHTML = "";

    const headRow = document.getElementById("bulkImportPreviewHead");
    headRow.innerHTML = "<th>แถว</th><th>บาร์โค้ด</th><th>ชื่อสินค้า</th><th>หมวดหมู่</th><th style='text-align:right;'>ต้นทุน</th><th style='text-align:right;'>ราคาขาย</th><th style='text-align:center;'>สต็อก</th><th>สถานะ/เหตุผล</th>";

    let validCount = 0;
    let invalidCount = 0;

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row.length === 0 || (row.length === 1 && !row[0])) continue;

      const barcode = String(row[barcodeIdx] || "").trim();
      const name = String(row[nameIdx] || "").trim();
      const category = String(row[categoryIdx] || "").trim();
      const cost = parseFloat(row[costIdx]);
      const price = parseFloat(row[priceIdx]);
      const stock = parseInt(row[stockIdx]);

      let isValid = true;
      let reasons = [];

      if (!barcode) {
        isValid = false;
        reasons.push("บาร์โค้ดว่าง");
      } else if (products.some(p => p.barcode === barcode) || tempImportData.some(p => p.barcode === barcode)) {
        isValid = false;
        reasons.push("บาร์โค้ดซ้ำ");
      }

      if (!name) {
        isValid = false;
        reasons.push("ชื่อสินค้าว่าง");
      }

      if (!category) {
        isValid = false;
        reasons.push("หมวดหมู่ว่าง");
      } else if (!categories.some(c => c.key === category)) {
        isValid = false;
        reasons.push(`ไม่พบ Key หมวดหมู่ "${category}"`);
      }

      if (isNaN(cost) || cost < 0) {
        isValid = false;
        reasons.push("ต้นทุนไม่ถูกต้อง");
      }

      if (isNaN(price) || price < 0) {
        isValid = false;
        reasons.push("ราคาขายไม่ถูกต้อง");
      }

      if (isNaN(stock) || stock < 0) {
        isValid = false;
        reasons.push("สต็อกไม่ถูกต้อง");
      }

      const parsedRow = {
        barcode, name, category, cost, price, stock, isValid,
        reason: reasons.join(", ")
      };

      tempImportData.push(parsedRow);

      const tr = document.createElement("tr");
      tr.className = isValid ? "row-valid" : "row-invalid";
      tr.innerHTML = `
        <td>${i}</td>
        <td>${barcode}</td>
        <td><strong>${name}</strong></td>
        <td>${getCategoryThaiName(category)}</td>
        <td style="text-align:right;">${isNaN(cost) ? "-" : "฿" + cost.toFixed(2)}</td>
        <td style="text-align:right;">${isNaN(price) ? "-" : "฿" + price.toFixed(2)}</td>
        <td style="text-align:center;">${isNaN(stock) ? "-" : stock}</td>
        <td>${isValid ? '<span style="color:var(--success); font-weight:bold;">ผ่าน</span>' : `<span class="error-reason">${parsedRow.reason}</span>`}</td>
      `;
      tbody.appendChild(tr);

      if (isValid) validCount++;
      else invalidCount++;
    }

    document.getElementById("bulkImportPreview").style.display = "block";
    document.getElementById("bulkImportSummary").innerHTML = `
      <div class="stat"><div class="num" style="color:var(--text-primary);">${tempImportData.length}</div><div class="label">แถวทั้งหมด</div></div>
      <div class="stat"><div class="num" style="color:var(--success); font-weight:bold;">${validCount}</div><div class="label">พร้อมนำเข้า</div></div>
      <div class="stat"><div class="num" style="color:var(--danger); font-weight:bold;">${invalidCount}</div><div class="label">ผิดพลาด</div></div>
    `;

    document.getElementById("bulkImportConfirmBtn").disabled = (validCount === 0);
  }

  document.getElementById("bulkImportConfirmBtn").addEventListener("click", async () => {
    const validRows = tempImportData.filter(r => r.isValid);
    if (validRows.length === 0) return;

    let maxId = 0;
    products.forEach(p => {
      const num = parseInt(p.id.replace("P", ""));
      if (!isNaN(num) && num > maxId) maxId = num;
    });

    let addedCount = 0;
    for (let row of validRows) {
      maxId++;
      const id = "P" + String(maxId).padStart(3, "0");
      const newProd = {
        id: id,
        name: row.name,
        barcode: row.barcode,
        category: row.category,
        price: row.price,
        cost: row.cost,
        stock: row.stock
      };

      products.push(newProd);
      await saveProductToDb(newProd);
      addedCount++;
    }

    logActivity("product", `นำเข้าสินค้าใหม่ผ่าน Excel สำเร็จ ${addedCount} รายการ`);
    showToast(`นำเข้าสินค้าใหม่สำเร็จ ${addedCount} รายการ!`);
    closeModal("bulkImportModal");
    renderCatalogTable();
    renderPOSCatalog();
    renderDashboard();
  });

  // 2. Restock via Excel
  document.getElementById("catalogRestockBtn").addEventListener("click", () => {
    document.getElementById("restockPreview").style.display = "none";
    document.getElementById("restockConfirmBtn").disabled = true;
    document.getElementById("restockFileInput").value = "";
    document.getElementById("restockDownloadMismatchedBtn").style.display = "none";
    openModal("restockModal");
  });

  document.getElementById("restockDownloadTemplateBtn").addEventListener("click", () => {
    const data = [
      ["barcode", "add_qty", "price", "cost"],
      ["8850999111101", 24, 15.00, 10.00],
      ["8850999111118", 10, "", ""]
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Restock Template");
    XLSX.writeFile(wb, "restock_template.xlsx");
    showToast("ดาวน์โหลด Template เรียบร้อย");
  });

  document.getElementById("restockDownloadMismatchedBtn").addEventListener("click", () => {
    if (mismatchedRestockProducts.length === 0) {
      showToast("ไม่มีรายการสินค้าที่พบข้อผิดพลาด", "warning");
      return;
    }

    const ws_data = [
      ["barcode", "name", "category", "cost", "price", "stock"]
    ];

    mismatchedRestockProducts.forEach(item => {
      ws_data.push([
        item.barcode,
        "", // blank name
        "General", // default category
        item.cost !== null && !isNaN(item.cost) ? item.cost : "",
        item.price !== null && !isNaN(item.price) ? item.price : "",
        item.stock
      ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(ws_data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "สินค้าใหม่ (Unregistered)");
    XLSX.writeFile(wb, "unregistered_barcodes_from_restock.xlsx");
    showToast("ดาวน์โหลดไฟล์สินค้าใหม่เรียบร้อย กรุณากรอกรายละเอียดให้ครบถ้วนแล้วนำเข้าผ่านเมนู นำเข้าสินค้า Excel", "success");
  });

  function processRestockJSON(rows) {
    if (rows.length < 2) {
      showToast("ไฟล์ Excel ไม่มีข้อมูล", "error");
      return;
    }

    const headers = rows[0].map(h => String(h || "").trim().toLowerCase());
    const barcodeIdx = headers.indexOf("barcode");
    const addQtyIdx = headers.indexOf("add_qty");
    const priceIdx = headers.indexOf("price");
    const costIdx = headers.indexOf("cost");

    if (barcodeIdx === -1 || addQtyIdx === -1 || priceIdx === -1 || costIdx === -1) {
      showToast("โครงสร้างไฟล์ไม่ถูกต้อง (กรุณาใช้ Template ที่ดาวน์โหลดจากระบบ)", "error");
      return;
    }

    tempRestockData = [];
    mismatchedRestockProducts = [];
    const tbody = document.getElementById("restockPreviewBody");
    tbody.innerHTML = "";

    let validCount = 0;
    let invalidCount = 0;

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row.length === 0 || (row.length === 1 && !row[0])) continue;

      const barcode = String(row[barcodeIdx] || "").trim();
      const addQty = parseInt(row[addQtyIdx]);
      
      const priceStr = String(row[priceIdx] || "").trim();
      const costStr = String(row[costIdx] || "").trim();
      const price = priceStr ? parseFloat(priceStr) : null;
      const cost = costStr ? parseFloat(costStr) : null;

      let isValid = true;
      let reasons = [];
      
      let systemProd = null;
      let name = "-";
      let oldStock = 0;
      let oldPrice = 0;
      let oldCost = 0;

      if (!barcode) {
        isValid = false;
        reasons.push("บาร์โค้ดว่าง");
      } else {
        systemProd = products.find(p => p.barcode === barcode);
        if (!systemProd) {
          isValid = false;
          reasons.push("ไม่พบสินค้าในระบบ");
          
          mismatchedRestockProducts.push({
            barcode: barcode,
            name: "",
            category: "General",
            cost: cost,
            price: price,
            stock: isNaN(addQty) || addQty <= 0 ? 0 : addQty
          });
        } else {
          name = systemProd.name;
          oldStock = systemProd.stock;
          oldPrice = systemProd.price;
          oldCost = systemProd.cost;
        }
      }

      if (isNaN(addQty) || addQty <= 0) {
        isValid = false;
        reasons.push("จำนวนชิ้นเพิ่มต้องมากกว่า 0");
      }

      if (priceStr && (isNaN(price) || price < 0)) {
        isValid = false;
        reasons.push("ราคาขายใหม่ไม่ถูกต้อง");
      }

      if (costStr && (isNaN(cost) || cost < 0)) {
        isValid = false;
        reasons.push("ต้นทุนใหม่ไม่ถูกต้อง");
      }

      const parsedRow = {
        barcode, addQty, price, cost, isValid,
        name, oldStock, newStock: oldStock + (isValid ? addQty : 0),
        oldPrice, oldCost,
        reason: reasons.join(", ")
      };

      tempRestockData.push(parsedRow);

      const tr = document.createElement("tr");
      tr.className = isValid ? "row-valid" : "row-invalid";

      let priceText = "฿" + oldPrice.toFixed(2);
      if (isValid && price !== null && price !== oldPrice) {
        priceText = `฿${oldPrice.toFixed(2)} → <strong style="color:var(--warning);">฿${price.toFixed(2)}</strong>`;
      }

      let costText = "฿" + oldCost.toFixed(2);
      if (isValid && cost !== null && cost !== oldCost) {
        costText = `฿${oldCost.toFixed(2)} → <strong style="color:var(--warning);">฿${cost.toFixed(2)}</strong>`;
      }

      tr.innerHTML = `
        <td>${barcode}</td>
        <td><strong>${name}</strong></td>
        <td style="text-align:center;">${systemProd ? oldStock : "-"}</td>
        <td style="text-align:center; color:var(--success); font-weight:bold;">${isNaN(addQty) ? "-" : "+" + addQty}</td>
        <td style="text-align:center; font-weight:bold;">${isValid ? oldStock + addQty : "-"}</td>
        <td style="text-align:right;">${priceText}</td>
        <td style="text-align:right;">${costText}</td>
        <td>${isValid ? '<span style="color:var(--success); font-weight:bold;">ผ่าน</span>' : `<span class="error-reason">${parsedRow.reason}</span>`}</td>
      `;
      tbody.appendChild(tr);

      if (isValid) validCount++;
      else invalidCount++;
    }

    document.getElementById("restockPreview").style.display = "block";
    document.getElementById("restockSummary").innerHTML = `
      <div class="stat"><div class="num" style="color:var(--text-primary);">${tempRestockData.length}</div><div class="label">แถวทั้งหมด</div></div>
      <div class="stat"><div class="num" style="color:var(--success); font-weight:bold;">${validCount}</div><div class="label">พร้อมเติมคลัง</div></div>
      <div class="stat"><div class="num" style="color:var(--danger); font-weight:bold;">${invalidCount}</div><div class="label">ผิดพลาด</div></div>
    `;

    const downloadBtn = document.getElementById("restockDownloadMismatchedBtn");
    if (mismatchedRestockProducts.length > 0) {
      downloadBtn.style.display = "flex";
    } else {
      downloadBtn.style.display = "none";
    }

    document.getElementById("restockConfirmBtn").disabled = (validCount === 0);
  }

  document.getElementById("restockConfirmBtn").addEventListener("click", async () => {
    const validRows = tempRestockData.filter(r => r.isValid);
    if (validRows.length === 0) return;

    let updatedCount = 0;
    for (let row of validRows) {
      const p = products.find(prod => prod.barcode === row.barcode);
      if (p) {
        p.stock += row.addQty;
        if (row.price !== null) p.price = row.price;
        if (row.cost !== null) p.cost = row.cost;
        
        await saveProductToDb(p);
        updatedCount++;
      }
    }

    logActivity("restock", `นำเข้าสต็อก (Restock) สำเร็จ ${updatedCount} รายการผ่าน Excel`);
    showToast(`เติมคลังสินค้าสำเร็จทั้งหมด ${updatedCount} รายการ!`);
    closeModal("restockModal");
    renderCatalogTable();
    renderPOSCatalog();
    renderDashboard();
  });

  // 3. Monthly Stock Reconciliation
  document.getElementById("catalogStockAuditBtn").addEventListener("click", () => {
    document.getElementById("stockAuditPreview").style.display = "none";
    document.getElementById("stockAuditConfirmBtn").disabled = true;
    document.getElementById("stockAuditFileInput").value = "";
    openModal("stockAuditModal");
  });

  document.getElementById("stockAuditDownloadTemplateBtn").addEventListener("click", () => {
    const data = [
      ["barcode", "name", "system_stock", "actual_stock"]
    ];
    products.forEach(p => {
      data.push([p.barcode, p.name, p.stock, ""]);
    });
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Audit Sheet");
    XLSX.writeFile(wb, "monthly_stock_audit_form.xlsx");
    showToast("ดาวน์โหลดแบบฟอร์มตรวจนับสำเร็จ!");
  });

  function processAuditJSON(rows) {
    if (rows.length < 2) {
      showToast("ไฟล์ Excel ไม่มีข้อมูล", "error");
      return;
    }

    const headers = rows[0].map(h => String(h || "").trim().toLowerCase());
    const barcodeIdx = headers.indexOf("barcode");
    const actualStockIdx = headers.indexOf("actual_stock");

    if (barcodeIdx === -1 || actualStockIdx === -1) {
      showToast("โครงสร้างไฟล์ไม่ถูกต้อง (ต้องมีคอลัมน์ barcode และ actual_stock)", "error");
      return;
    }

    tempAuditData = [];
    const tbody = document.getElementById("stockAuditPreviewBody");
    tbody.innerHTML = "";

    let matchedCount = 0;
    let shortCount = 0;
    let overCount = 0;
    let totalLoss = 0;
    let validCount = 0;

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row.length === 0 || (row.length === 1 && !row[0])) continue;

      const barcode = String(row[barcodeIdx] || "").trim();
      const actualStock = parseInt(row[actualStockIdx]);

      let isValid = true;
      let reasons = [];
      
      let systemProd = null;
      let name = "-";
      let systemStock = 0;
      let cost = 0;

      if (!barcode) {
        isValid = false;
        reasons.push("บาร์โค้ดว่าง");
      } else {
        systemProd = products.find(p => p.barcode === barcode);
        if (!systemProd) {
          isValid = false;
          reasons.push("ไม่พบสินค้าในระบบ");
        } else {
          name = systemProd.name;
          systemStock = systemProd.stock;
          cost = systemProd.cost;
        }
      }

      if (isNaN(actualStock) || actualStock < 0) {
        isValid = false;
        reasons.push("จำนวนนับจริงไม่ถูกต้อง");
      }

      const variance = isValid ? (actualStock - systemStock) : 0;
      let status = "ผิดพลาด";
      let statusClass = "error-reason";
      let loss = 0;

      if (isValid) {
        validCount++;
        if (variance === 0) {
          status = "ตรง";
          statusClass = "matched";
          matchedCount++;
        } else if (variance < 0) {
          status = "ขาดหาย";
          statusClass = "short";
          shortCount++;
          loss = Math.abs(variance) * cost;
          totalLoss += loss;
        } else {
          status = "เกิน";
          statusClass = "over";
          overCount++;
        }
      }

      const parsedRow = {
        barcode, name, systemStock, actualStock, variance, cost, loss, isValid, status,
        reason: reasons.join(", ")
      };

      tempAuditData.push(parsedRow);

      const tr = document.createElement("tr");
      tr.className = isValid ? (variance === 0 ? "row-valid" : (variance < 0 ? "row-invalid" : "row-valid")) : "row-invalid";

      let varianceText = variance === 0 ? "0" : (variance > 0 ? "+" + variance : variance);
      let varianceBadge = `<span class="variance-badge ${statusClass}">${varianceText} (${status})</span>`;
      if (!isValid) varianceBadge = `<span class="error-reason">${parsedRow.reason}</span>`;

      tr.innerHTML = `
        <td>${barcode}</td>
        <td><strong>${name}</strong></td>
        <td style="text-align:center;">${systemProd ? systemStock : "-"}</td>
        <td style="text-align:center; font-weight:bold;">${isValid ? actualStock : "-"}</td>
        <td style="text-align:center;">${varianceBadge}</td>
        <td style="text-align:right;">${systemProd ? "฿" + cost.toFixed(2) : "-"}</td>
        <td style="text-align:right; font-weight:600; color:var(--danger);">${loss > 0 ? "฿" + loss.toFixed(2) : "-"}</td>
        <td>${isValid ? `<span class="variance-badge ${statusClass}">${status}</span>` : `<span class="error-reason">ผิดพลาด</span>`}</td>
      `;
      tbody.appendChild(tr);
    }

    document.getElementById("stockAuditPreview").style.display = "block";
    document.getElementById("auditCountMatched").textContent = matchedCount;
    document.getElementById("auditCountShort").textContent = shortCount;
    document.getElementById("auditCountOver").textContent = overCount;
    document.getElementById("auditTotalLoss").textContent = "฿" + totalLoss.toFixed(2);

    document.getElementById("stockAuditConfirmBtn").disabled = (validCount === 0);
  }

  document.getElementById("stockAuditConfirmBtn").addEventListener("click", async () => {
    const validRows = tempAuditData.filter(r => r.isValid);
    if (validRows.length === 0) return;

    let matched = 0, short = 0, over = 0;
    for (let row of validRows) {
      const p = products.find(prod => prod.barcode === row.barcode);
      if (p) {
        const diff = row.actualStock - p.stock;
        if (diff === 0) matched++;
        else if (diff < 0) short++;
        else over++;
        
        p.stock = row.actualStock;
        await saveProductToDb(p);
      }
    }

    logActivity("audit", `ตรวจนับสต็อกรายเดือน - ลงตัว ${matched}, ขาดหาย ${short}, เกิน ${over} รายการ`);
    showToast(`บันทึกตรวจนับสต็อกสำเร็จ! (จำนวน ${validRows.length} รายการ)`);
    document.getElementById("stockAuditConfirmBtn").disabled = true;

    renderCatalogTable();
    renderPOSCatalog();
    renderDashboard();
  });

  // Export Stock Variance Excel Report
  document.getElementById("auditExportVarianceBtn").addEventListener("click", () => {
    if (tempAuditData.length === 0) return;

    const ws_data = [
      ["บาร์โค้ด", "ชื่อสินค้า", "สต็อกในระบบ", "จำนวนนับจริง", "ผลต่าง (Variance)", "ราคาทุนต่อหน่วย (บาท)", "มูลค่าส่วนต่างหาย (บาท)", "สถานะ"]
    ];

    tempAuditData.forEach(row => {
      ws_data.push([
        row.barcode,
        row.name,
        row.isValid ? row.systemStock : "",
        row.isValid ? row.actualStock : "",
        row.isValid ? (row.variance === 0 ? "0" : (row.variance > 0 ? "+" + row.variance : row.variance)) : "",
        row.isValid ? row.cost : "",
        row.isValid ? row.loss : "",
        row.status
      ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(ws_data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Stock Variance Report");
    XLSX.writeFile(wb, "stock_variance_report.xlsx");
    showToast("ส่งออกรายงานส่วนต่างคลังสินค้าสำเร็จ!");
  });

  // --- REPORT SALES VIEW ---
  function renderSalesReportTable() {
    const tbody = document.getElementById("reportSalesTableBody");
    const startDate = document.getElementById("reportStartDate").value;
    const endDate = document.getElementById("reportEndDate").value;
    const catSelect = document.getElementById("reportCategorySelect").value;
    const paymentSelect = document.getElementById("reportPaymentSelect").value;

    tbody.innerHTML = "";

    let totalQty = 0;
    let totalCost = 0;
    let totalRevenue = 0;
    let totalProfit = 0;

    const reportRows = [];

    transactions.forEach(tx => {
      const txDate = tx.timestamp.split("T")[0];
      if (startDate && txDate < startDate) return;
      if (endDate && txDate > endDate) return;
      if (paymentSelect !== "All" && tx.paymentMethod !== paymentSelect) return;

      const isVoided = tx.voided === true;

      tx.items.forEach(item => {
        if (catSelect !== "All" && item.category !== catSelect) return;

        // Display negative values for voided transactions to subtract from totals
        reportRows.push({
          txId: tx.id,
          timestamp: tx.timestamp,
          barcode: item.barcode,
          name: item.name + (isVoided ? " (ยกเลิกบิล)" : ""),
          category: item.category,
          quantity: isVoided ? -item.quantity : item.quantity,
          totalCost: isVoided ? -item.totalCost : item.totalCost,
          totalPrice: isVoided ? -item.totalPrice : item.totalPrice,
          profit: isVoided ? -(item.totalPrice - item.totalCost) : (item.totalPrice - item.totalCost),
          paymentMethod: tx.paymentMethod,
          isVoided: isVoided
        });
      });
    });

    if (reportRows.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="11" style="text-align: center; color: var(--text-muted); padding: 2rem;">
            ไม่พบยอดขายตามช่วงเวลาหรือเงื่อนไขที่เลือก
          </td>
        </tr>
      `;
      document.getElementById("reportTotalQty").textContent = "0";
      document.getElementById("reportTotalCost").textContent = "฿0.00";
      document.getElementById("reportTotalRevenue").textContent = "฿0.00";
      document.getElementById("reportTotalProfit").textContent = "฿0.00";
      return;
    }

    // Sort report rows descending by date
    reportRows.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    reportRows.forEach(row => {
      const r = document.createElement("tr");
      if (row.isVoided) {
        r.style.opacity = "0.6";
        r.style.textDecoration = "line-through";
      }

      const d = new Date(row.timestamp);
      const timeStr = d.toLocaleDateString("th-TH") + " " + d.toLocaleTimeString("th-TH", { hour: '2-digit', minute: '2-digit' });

      totalQty += row.quantity;
      totalCost += row.totalCost;
      totalRevenue += row.totalPrice;
      totalProfit += row.profit;

      const qtyText = row.quantity < 0 ? `-${Math.abs(row.quantity)}` : `${row.quantity}`;
      const costText = row.totalCost < 0 ? `-฿${Math.abs(row.totalCost).toFixed(2)}` : `฿${row.totalCost.toFixed(2)}`;
      const revenueText = row.totalPrice < 0 ? `-฿${Math.abs(row.totalPrice).toFixed(2)}` : `฿${row.totalPrice.toFixed(2)}`;
      const profitText = row.profit < 0 ? `-฿${Math.abs(row.profit).toFixed(2)}` : `฿${row.profit.toFixed(2)}`;

      const actionBtn = row.isVoided
        ? `<span style="color:var(--danger); font-weight:bold; font-size:0.75rem;">ยกเลิกแล้ว</span>`
        : `<button class="btn btn-danger btn-sm void-tx-btn admin-only" data-id="${row.txId}" style="padding:0.2rem 0.5rem; font-size:0.7rem;">คืน/ยกเลิก</button>`;

      r.innerHTML = `
        <td>${timeStr}</td>
        <td style="font-family: monospace; font-weight: bold;">${row.txId}</td>
        <td class="barcode-cell">${row.barcode}</td>
        <td><strong>${row.name}</strong></td>
        <td>${getCategoryThaiName(row.category)}</td>
        <td style="text-align: right; font-family: monospace;">${qtyText}</td>
        <td style="text-align: right; font-family: monospace;">${costText}</td>
        <td style="text-align: right; font-family: monospace; font-weight: 600; color: ${row.totalPrice < 0 ? 'var(--danger)' : 'var(--accent-secondary)'};">${revenueText}</td>
        <td style="text-align: right; font-family: monospace; font-weight: 600; color: ${row.profit < 0 ? 'var(--danger)' : 'var(--success)'};">${profitText}</td>
        <td style="text-align: center; font-size: 0.8rem; font-weight: 600;">
          ${getPaymentBadge(row.paymentMethod)}
        </td>
        <td style="text-align: center;" class="admin-only">${actionBtn}</td>
      `;

      // Return / Void Event Listener
      if (!row.isVoided) {
        const voidBtn = r.querySelector(".void-tx-btn");
        if (voidBtn) {
          voidBtn.addEventListener("click", () => {
            voidTransaction(row.txId);
          });
        }
      }

      tbody.appendChild(r);
    });

    document.getElementById("reportTotalQty").textContent = totalQty.toLocaleString("th-TH");
    document.getElementById("reportTotalCost").textContent = `฿${totalCost.toLocaleString("th-TH", { minimumFractionDigits: 2 })}`;
    document.getElementById("reportTotalRevenue").textContent = `฿${totalRevenue.toLocaleString("th-TH", { minimumFractionDigits: 2 })}`;
    document.getElementById("reportTotalProfit").textContent = `฿${totalProfit.toLocaleString("th-TH", { minimumFractionDigits: 2 })}`;
  }

  // Void/Return Transaction Handler
  async function voidTransaction(txId) {
    if (!confirm(`คุณต้องการยกเลิกบิลยอดขาย "${txId}" คืนสต็อกและหักยอดขายใช่หรือไม่?`)) return;

    const tx = transactions.find(t => t.id === txId);
    if (!tx || tx.voided) return;

    tx.voided = true;

    // Record to local storage voided index
    const voidedIds = JSON.parse(localStorage.getItem("smartsales_voided_txs") || "[]");
    if (!voidedIds.includes(txId)) {
      voidedIds.push(txId);
      localStorage.setItem("smartsales_voided_txs", JSON.stringify(voidedIds));
    }

    // Revert Stocks of products
    for (let item of tx.items) {
      const p = products.find(prod => prod.id === item.productId);
      if (p) {
        p.stock += item.quantity;
        await saveProductToDb(p);
      }
    }

    saveLocalFallback();

    logActivity("return", `ยกเลิกบิล ${txId} - คืนสินค้าและเงินจำนวน ฿${tx.total.toFixed(2)}`);
    showToast(`ยกเลิกบิล ${txId} และหักสต็อกสินค้าสำเร็จแล้ว`, "success");

    renderSalesReportTable();
    renderCatalogTable();
    renderPOSCatalog();
    renderDashboard();
  }

  function getPaymentBadge(method) {
    if (method === "Cash") return `<span style="color: var(--success);"><i data-lucide="banknote" style="width:12px; height:12px; vertical-align:-2px; margin-right:2px; display:inline-block;"></i> เงินสด</span>`;
    if (method === "QR Code") return `<span style="color: var(--accent-secondary);"><i data-lucide="qr-code" style="width:12px; height:12px; vertical-align:-2px; margin-right:2px; display:inline-block;"></i> พร้อมเพย์</span>`;
    return `<span style="color: var(--accent-primary);"><i data-lucide="credit-card" style="width:12px; height:12px; vertical-align:-2px; margin-right:2px; display:inline-block;"></i> บัตรเครดิต</span>`;
  }

  document.getElementById("reportStartDate").addEventListener("change", renderSalesReportTable);
  document.getElementById("reportEndDate").addEventListener("change", renderSalesReportTable);
  document.getElementById("reportCategorySelect").addEventListener("change", renderSalesReportTable);
  document.getElementById("reportPaymentSelect").addEventListener("change", renderSalesReportTable);

  // EXPORT CSV UTILITY
  document.getElementById("reportExportCsvBtn").addEventListener("click", () => {
    const tbody = document.getElementById("reportSalesTableBody");
    const trs = tbody.querySelectorAll("tr");

    if (trs.length === 1 && trs[0].innerText.includes("ไม่พบยอดขาย")) {
      showToast("ไม่มีข้อมูลในตารางให้ส่งออกรายงาน", "error");
      return;
    }

    let csvContent = "วันที่-เวลา,เลขที่บิล,บาร์โค้ด,ชื่อสินค้า,หมวดหมู่,จำนวนขาย,ราคาทุนรวม,ราคาขายรวม,กำไรสุทธิ,ช่องทางการชำระเงิน\r\n";

    trs.forEach(tr => {
      const tds = tr.querySelectorAll("td");
      
      const dateTime = tds[0].textContent;
      const billNo = tds[1].textContent;
      const barcode = tds[2].textContent;
      const name = tds[3].textContent.replace(/,/g, " ");
      const category = tds[4].textContent;
      const qty = tds[5].textContent;
      const cost = tds[6].textContent.replace("฿", "").replace(/,/g, "");
      const revenue = tds[7].textContent.replace("฿", "").replace(/,/g, "");
      const profit = tds[8].textContent.replace("฿", "").replace(/,/g, "");
      const method = tds[9].textContent.trim();

      csvContent += `${dateTime},${billNo},'${barcode},${name},${category},${qty},${cost},${revenue},${profit},${method}\r\n`;
    });

    const BOM = "\uFEFF";
    const blob = new Blob([BOM + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement("a");
    const startVal = document.getElementById("reportStartDate").value;
    const endVal = document.getElementById("reportEndDate").value;
    
    link.setAttribute("href", url);
    link.setAttribute("download", `sales_report_${startVal}_to_${endVal}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showToast("ส่งออกข้อมูลรายงานสำเร็จ!");
  });

  // --- ACTIVITY LOG AUDIT TRAIL VIEW ---
  function renderActivityLogTable() {
    const list = document.getElementById("activityLogList");
    const userFilter = document.getElementById("logUserFilter").value;
    const typeFilter = document.getElementById("logTypeFilter").value;
    const dateFilter = document.getElementById("logDateFilter").value;

    list.innerHTML = "";

    const filtered = activityLog.filter(log => {
      if (userFilter !== "All" && log.user !== userFilter) return false;
      if (typeFilter !== "All" && log.type !== typeFilter) return false;
      if (dateFilter) {
        const logDate = log.timestamp.split("T")[0];
        if (logDate !== dateFilter) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      list.innerHTML = `
        <div class="log-empty">
          <i data-lucide="scroll-text" style="width:40px; height:40px; margin-bottom:0.75rem;"></i>
          <p>ไม่พบบันทึกกิจกรรมตามเงื่อนไขที่เลือก</p>
        </div>
      `;
      lucide.createIcons();
      return;
    }

    // Sort logs descending (newest first)
    const sorted = [...filtered].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    sorted.forEach(log => {
      const d = new Date(log.timestamp);
      const timeStr = d.toLocaleDateString("th-TH") + " " + d.toLocaleTimeString("th-TH");
      
      const item = document.createElement("div");
      item.className = "log-entry";
      
      let badgeClass = "system";
      let typeLabel = "ระบบ";
      if (log.type === "sale") { badgeClass = "sale"; typeLabel = "💰 ขายสินค้า"; }
      else if (log.type === "price-change") { badgeClass = "price-change"; typeLabel = "✏️ ปรับราคา POS"; }
      else if (log.type === "restock") { badgeClass = "restock"; typeLabel = "📦 Restock"; }
      else if (log.type === "audit") { badgeClass = "audit"; typeLabel = "📊 Audit"; }
      else if (log.type === "product") { badgeClass = "product"; typeLabel = "➕ จัดการสินค้า"; }
      else if (log.type === "return") { badgeClass = "return"; typeLabel = "🔴 คืน/ยกเลิก"; }

      const userClass = log.user === "admin" ? "admin" : "cashier";
      const userLabel = log.user.toUpperCase();

      item.innerHTML = `
        <span class="log-time">${timeStr}</span>
        <span class="log-user ${userClass}">${userLabel}</span>
        <span><span class="log-type-badge ${badgeClass}">${typeLabel}</span></span>
        <span class="log-detail">${log.detail}</span>
      `;
      list.appendChild(item);
    });
  }

  document.getElementById("logUserFilter").addEventListener("change", renderActivityLogTable);
  document.getElementById("logTypeFilter").addEventListener("change", renderActivityLogTable);
  document.getElementById("logDateFilter").addEventListener("change", renderActivityLogTable);

  // Clear Logs > 30 days
  document.getElementById("logClearOldBtn").addEventListener("click", () => {
    if (!confirm("คุณแน่ใจว่าต้องการล้างบันทึกกิจกรรมที่เก่ากว่า 30 วัน?")) return;

    const limitDate = new Date();
    limitDate.setDate(limitDate.getDate() - 30);
    
    const initialLen = activityLog.length;
    activityLog = activityLog.filter(log => new Date(log.timestamp) >= limitDate);
    const cleared = initialLen - activityLog.length;

    localStorage.setItem("smartsales_activity_log", JSON.stringify(activityLog));
    showToast(`ล้างประวัติกิจกรรมที่เก่ากว่า 30 วันสำเร็จ (${cleared} รายการ)`, "warning");
    renderActivityLogTable();
  });

  // Export logs to CSV
  document.getElementById("logExportCsvBtn").addEventListener("click", () => {
    if (activityLog.length === 0) {
      showToast("ไม่มีข้อมูลกิจกรรมให้ส่งออก", "error");
      return;
    }

    let csvContent = "วันที่-เวลา,ชื่อผู้ใช้,ประเภท,รายละเอียดกิจกรรม\r\n";
    activityLog.forEach(log => {
      const d = new Date(log.timestamp);
      const timeStr = d.toLocaleDateString("th-TH") + " " + d.toLocaleTimeString("th-TH");
      const detail = log.detail.replace(/,/g, " ");
      csvContent += `${timeStr},${log.user.toUpperCase()},${log.type.toUpperCase()},${detail}\r\n`;
    });

    const BOM = "\uFEFF";
    const blob = new Blob([BOM + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `smartsales_activity_audit_logs.csv`;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("ส่งออกไฟล์ CSV บันทึกกิจกรรมสำเร็จ!");
  });

  // --- END OF DAY CASH RECONCILIATION ---
  document.getElementById("eodReconcileBtn").addEventListener("click", () => {
    const todayStr = new Date().toISOString().split("T")[0];
    // Cash transactions today (exclude voided)
    const cashTxs = transactions.filter(t => t.timestamp.startsWith(todayStr) && t.paymentMethod === "Cash" && !t.voided);
    const systemCash = cashTxs.reduce((sum, t) => sum + t.total, 0);

    document.getElementById("eodSystemCash").textContent = `฿${systemCash.toFixed(2)}`;
    document.getElementById("eodCashTxCount").textContent = `${cashTxs.length} บิล`;
    
    document.getElementById("eodActualCashInput").value = "";
    document.getElementById("eodResultWrapper").style.display = "none";
    
    openModal("eodReconcileModal");
  });

  document.getElementById("eodActualCashInput").addEventListener("input", () => {
    const systemCashText = document.getElementById("eodSystemCash").textContent.replace("฿", "").replace(/,/g, "");
    const systemCash = parseFloat(systemCashText) || 0;
    const actualCashVal = document.getElementById("eodActualCashInput").value;
    const resultWrapper = document.getElementById("eodResultWrapper");
    
    if (actualCashVal === "") {
      resultWrapper.style.display = "none";
      return;
    }

    const actualCash = parseFloat(actualCashVal);
    const diff = actualCash - systemCash;
    
    const resultBox = document.getElementById("eodResultBox");
    const diffAmount = document.getElementById("eodDiffAmount");
    const diffStatus = document.getElementById("eodDiffStatus");
    
    resultWrapper.style.display = "block";
    
    if (diff === 0) {
      resultBox.className = "eod-result balanced";
      diffAmount.textContent = "฿0.00";
      diffStatus.textContent = "ยอดเงินสดตรงพอดี (Balanced)";
    } else {
      resultBox.className = "eod-result unbalanced";
      diffAmount.textContent = diff > 0 ? `+฿${diff.toFixed(2)}` : `-฿${Math.abs(diff).toFixed(2)}`;
      diffStatus.textContent = diff > 0 ? "ยอดเงินสดเกินในลิ้นชัก (Surplus)" : "ยอดเงินสดขาดหายไป (Shortage)";
    }
  });

  document.getElementById("eodConfirmBtn").addEventListener("click", () => {
    const systemCashText = document.getElementById("eodSystemCash").textContent.replace("฿", "").replace(/,/g, "");
    const systemCash = parseFloat(systemCashText) || 0;
    const actualCashVal = document.getElementById("eodActualCashInput").value;
    
    if (actualCashVal === "") {
      showToast("กรุณากรอกยอดเงินสดนับจริงในลิ้นชัก", "error");
      return;
    }

    const actualCash = parseFloat(actualCashVal);
    const diff = actualCash - systemCash;

    const entry = {
      timestamp: new Date().toISOString(),
      system_cash: systemCash,
      actual_cash: actualCash,
      diff: diff,
      user: currentUser ? currentUser.name : "System"
    };

    eodHistory.push(entry);
    localStorage.setItem("smartsales_eod_history", JSON.stringify(eodHistory));

    logActivity("system", `ปิดยอดประจำวัน - ยอดขายระบบ: ฿${systemCash.toFixed(2)}, เงินในเครื่อง: ฿${actualCash.toFixed(2)} (ส่วนต่าง: ฿${diff.toFixed(2)})`);
    showToast("บันทึกการปิดยอดประจำวันสำเร็จ!");
    
    closeModal("eodReconcileModal");
    renderEODHistory();
  });

  function renderEODHistory() {
    const tbody = document.getElementById("eodHistoryTableBody");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (eodHistory.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:1.5rem;">ยังไม่มีบันทึกประวัติการปิดยอดประจำวัน</td></tr>';
      return;
    }

    const sorted = [...eodHistory].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    sorted.forEach(entry => {
      const d = new Date(entry.timestamp);
      const timeStr = d.toLocaleDateString("th-TH") + " " + d.toLocaleTimeString("th-TH", { hour: '2-digit', minute: '2-digit' });
      
      let statusColor = "var(--success)";
      let statusText = "ลงตัว";
      if (entry.diff !== 0) {
        statusColor = entry.diff > 0 ? "var(--warning)" : "var(--danger)";
        statusText = entry.diff > 0 ? "เงินเกิน" : "เงินขาด";
      }

      const diffValText = entry.diff === 0 
        ? "฿0.00" 
        : (entry.diff > 0 ? `+฿${entry.diff.toFixed(2)}` : `-฿${Math.abs(entry.diff).toFixed(2)}`);

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${timeStr}</td>
        <td style="font-family:monospace; text-align:right;">฿${entry.system_cash.toFixed(2)}</td>
        <td style="font-family:monospace; text-align:right;">฿${entry.actual_cash.toFixed(2)}</td>
        <td style="font-family:monospace; text-align:right; color:${statusColor}; font-weight:bold;">${diffValText}</td>
        <td style="color:${statusColor}; font-weight:bold;">${statusText}</td>
        <td>${entry.user}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  // --- BACKUP / RESTORE JSON ---
  document.getElementById("backupDataBtn").addEventListener("click", () => {
    const backupObj = {
      products,
      transactions,
      categories,
      activityLog,
      eodHistory,
      voidedTransactions: JSON.parse(localStorage.getItem("smartsales_voided_txs") || "[]")
    };
    
    const jsonString = JSON.stringify(backupObj, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    
    const today = new Date().toISOString().split("T")[0];
    const link = document.createElement("a");
    link.href = url;
    link.download = `smartsales_backup_${today}.json`;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    logActivity("system", "สำรองข้อมูลของระบบ (Backup JSON)");
    showToast("ส่งออกไฟล์สำรองระบบสำเร็จ!");
  });

  const restoreBtn = document.getElementById("restoreDataBtn");
  const restoreInput = document.getElementById("restoreFileInput");
  restoreBtn.addEventListener("click", () => {
    restoreInput.click();
  });

  restoreInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function(evt) {
      try {
        const backupData = JSON.parse(evt.target.result);
        if (!backupData.products || !backupData.transactions) {
          showToast("โครงสร้างไฟล์กู้คืนระบบไม่ถูกต้อง", "error");
          return;
        }

        if (!confirm("คุณต้องการกู้คืนข้อมูลใช่หรือไม่? ข้อมูลสินค้า ยอดขาย และประวัติทั้งหมดในเครื่องนี้จะถูกเขียนทับทันที!")) return;

        products = backupData.products;
        transactions = backupData.transactions;
        if (backupData.categories) categories = backupData.categories;
        if (backupData.activityLog) activityLog = backupData.activityLog;
        if (backupData.eodHistory) eodHistory = backupData.eodHistory;

        const voidedTxs = backupData.voidedTransactions || [];
        localStorage.setItem("smartsales_voided_txs", JSON.stringify(voidedTxs));

        // Save fallback
        saveLocalFallback();
        localStorage.setItem("smartsales_categories", JSON.stringify(categories));
        localStorage.setItem("smartsales_activity_log", JSON.stringify(activityLog));
        localStorage.setItem("smartsales_eod_history", JSON.stringify(eodHistory));

        // If D1 connected, sync restored data to D1 Database
        if (isCloudflareDb) {
          showToast("กำลังกู้คืนฐานข้อมูล Cloudflare D1 Database...", "warning");
          // Overwrite D1 Products
          for (let p of products) {
            await fetch("/api/products", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(p)
            });
          }
          // Overwrite D1 Transactions
          for (let t of transactions) {
            await fetch("/api/transactions", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(t)
            });
          }
        }

        logActivity("system", "กู้คืนระบบจากไฟล์กู้คืน (Restore JSON) สำเร็จ");
        showToast("กู้คืนระบบเรียบร้อยแล้ว! ระบบจะทำการรีโหลดหน้าใน 1.5 วินาที", "success");
        setTimeout(() => {
          window.location.reload();
        }, 1500);

      } catch (err) {
        showToast("ล้มเหลวในการอ่านไฟล์กู้คืนระบบ", "error");
        console.error(err);
      }
    };
    reader.readAsText(file);
  });

  // --- MODALS TOGGLERS CONTROLLER ---
  function openModal(modalId) {
    const modal = document.getElementById(modalId);
    modal.classList.add("active");
  }

  function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    modal.classList.remove("active");
    
    if (modalId === "cameraScannerModal") {
      stopCameraScanner();
    }
  }

  const closeButtons = document.querySelectorAll(".modal-close-btn, .modal-close-action-btn");
  closeButtons.forEach(btn => {
    btn.addEventListener("click", (e) => {
      const modal = e.target.closest(".modal-overlay");
      if (modal) {
        closeModal(modal.id);
      }
    });
  });

  document.getElementById("receiptPrintBtn").addEventListener("click", () => {
    window.print();
  });

  document.getElementById("barcodeLabelsPrintBtn").addEventListener("click", () => {
    window.print();
  });

  // Start Auth Check and System Load
  checkLoginState();
});
