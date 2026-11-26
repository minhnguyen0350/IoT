
// API backend chay cung origin voi giao dien.
const API_BASE = "/api";

async function apiRequest(endpoint, options = {}) {
    const token = localStorage.getItem("authToken");
    const headers = {
        "Content-Type": "application/json",
        ...(options.headers || {})
    };

    if (token && endpoint !== "/auth/sign-in") {
        headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers
    });

    const result = await response.json().catch(() => ({}));

    if (response.status === 401 && endpoint !== "/auth/sign-in") {
        localStorage.removeItem("authToken");
        localStorage.removeItem("authUser");
        window.location.href = "index.html";
        throw new Error("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
    }

    if (!response.ok) {
        throw new Error(result.message || `API error: ${response.status}`);
    }

    return result;
}


function updateLedDisplay(number, isOn) {
    const led = document.getElementById(`led${number}`);
    const status = document.getElementById(`led${number}Status`);
    const bulb = document.getElementById(`bulb${number}`);

    if (!led) return;

    led.classList.toggle("on", isOn);
    led.classList.remove("led-loading");

    if (status) {
        status.textContent = isOn ? "ON" : "OFF";
        status.classList.toggle("on", isOn);
        status.classList.toggle("off", !isOn);
    }

    if (bulb) {
        bulb.classList.toggle("inactive-bulb", !isOn);
    }
}


// ==============================
// LOGIN / LOGOUT
// ==============================

async function handleLogin() {
    const username = document.getElementById("username")?.value.trim();
    const password = document.getElementById("password")?.value || "";
    const button = document.querySelector(".login-submit");

    if (!username || !password) {
        alert("Vui lòng nhập tên đăng nhập và mật khẩu.");
        return;
    }

    if (button) button.disabled = true;

    try {
        const result = await apiRequest("/auth/sign-in", {
            method: "POST",
            body: JSON.stringify({ username, password })
        });

        localStorage.setItem("authToken", result.token);
        localStorage.setItem("authUser", JSON.stringify(result.user));
        localStorage.setItem("profileName", result.user.fullName || result.user.username);
        localStorage.setItem("profileRole", result.user.role || "USER");
        window.location.href = "dashboard.html";
    } catch (error) {
        alert(error.message || "Đăng nhập không thành công.");
    } finally {
        if (button) button.disabled = false;
    }
}


function handleLogout() {
    localStorage.removeItem("authToken");
    localStorage.removeItem("authUser");
    window.location.href = "index.html";
}


// ==============================
// LED CONTROL
// Gửi lệnh điều khiển LED qua Backend và MQTT.
// ==============================

async function setLedPower(number) {
    const led = document.getElementById(`led${number}`);
    const status = document.getElementById(`led${number}Status`);

    if (!led || led.classList.contains("led-loading")) return;

    const turnOn = !led.classList.contains("on");
    const loadingStart = Date.now();

    led.classList.add("led-loading");

    if (status) {
        status.textContent = "LOADING";
    }

    try {
        await apiRequest("/dashboard/control", {
            method: "POST",
            body: JSON.stringify({
                device: "LED",
                target_number: number,
                action: turnOn ? 1 : 0
            })
        });

        // Giữ trạng thái Loading tối thiểu 500ms.
        const elapsed = Date.now() - loadingStart;
        const remaining = Math.max(0, 500 - elapsed);

        if (remaining > 0) {
            await new Promise(resolve => setTimeout(resolve, remaining));
        }

        // Đồng bộ trạng thái thực tế từ ESP32.
        await refreshLedStates();

    } catch (error) {
        led.classList.remove("led-loading");

        if (status) {
            status.textContent = "ERROR";
        }

        alert(`Không điều khiển được LED ${number}: ${error.message}`);
    }
}


async function refreshLedStates() {
    try {
        const result = await apiRequest("/dashboard/led");

        updateLedDisplay(1, Boolean(result.leds.led1));
        updateLedDisplay(2, Boolean(result.leds.led2));

    } catch (error) {
        console.warn("Không lấy được trạng thái LED:", error.message);
    }
}


// ==============================
// SENSOR SAMPLE DATA
// Dữ liệu cảm biến mô phỏng
// ==============================

let sampleReadings = [];
let sampleActivityLog = [];


// ==============================
// TABLE PAGINATION
// Xử lý phân trang dùng chung
// ==============================

function createTableController({
    tbody,
    rows: initialRows,
    columns,
    renderRow,
    filterRows,
    captureFilters
}) {
    if (!tbody) {
        return () => {};
    }

    let rows = [...initialRows];

    const card = tbody.closest(".table-card");
    const pageSizeSelect = card.querySelector(".page-size-select");
    const pageNumbers = card.querySelector(".page-numbers");

    const searchButton = document.querySelector(".search-button");
    const resetButton = document.querySelector(".reset-button");

    let filtered = [...rows];
    let currentPage = 1;


    // Hiển thị dữ liệu theo trang.
    function draw() {
        const pageSize = Number(pageSizeSelect.value) || 10;

        const totalPages = Math.max(
            1,
            Math.ceil(filtered.length / pageSize)
        );

        currentPage = Math.min(currentPage, totalPages);

        const start = (currentPage - 1) * pageSize;

        tbody.innerHTML = "";

        if (!filtered.length) {
            const tr = document.createElement("tr");

            tr.innerHTML = `
                <td colspan="${columns}" class="empty-table-message">
                    Không tìm thấy dữ liệu
                </td>
            `;

            tbody.appendChild(tr);

        } else {
            filtered
                .slice(start, start + pageSize)
                .forEach((row, index) => {
                    tbody.insertAdjacentHTML(
                        "beforeend",
                        renderRow(row, start + index + 1)
                    );
                });
        }


        // Hiển thị các nút chuyển trang.
        pageNumbers.innerHTML = "";

        if (totalPages > 1) {
            const add = (label, page, active = false) => {
                const b = document.createElement("button");

                b.className = "page" + (active ? " active" : "");
                b.textContent = label;
                b.type = "button";
                b.disabled = active;

                b.addEventListener("click", () => {
                    currentPage = page;
                    draw();
                });

                pageNumbers.appendChild(b);
            };

            if (currentPage > 1) {
                add("‹", currentPage - 1);
            }

            for (let p = 1; p <= totalPages; p++) {
                add(String(p), p, p === currentPage);
            }

            if (currentPage < totalPages) {
                add("›", currentPage + 1);
            }
        }
    }


    // Áp dụng điều kiện đã được xác nhận bằng Search.
    function applyFilters() {
        if (captureFilters) {
            captureFilters();
        }

        filtered = filterRows
            ? rows.filter(filterRows)
            : [...rows];

        currentPage = 1;
        draw();
    }


    // Chỉ tìm kiếm khi nhấn nút Search.
    searchButton?.addEventListener("click", applyFilters);


    // Chỉ đặt lại bộ lọc khi nhấn nút Reset.
    resetButton?.addEventListener("click", () => {
        document.querySelectorAll(".filter-box input").forEach(input => {
            input.value = "";
        });

        document.querySelectorAll(".filter-box select").forEach(select => {
            select.selectedIndex = 0;
        });

        applyFilters();
    });


    // Thay đổi số dòng hiển thị.
    pageSizeSelect?.addEventListener("change", () => {
        currentPage = 1;
        draw();
    });

    draw();


    // Cập nhật dữ liệu mới nhưng giữ nguyên bộ lọc đã áp dụng.
    return newRows => {
        rows = [...newRows];

        filtered = filterRows
            ? rows.filter(filterRows)
            : [...rows];

        draw();
    };
}


// ==============================
// SENSOR DATA TABLE
// Bảng dữ liệu cảm biến
// ==============================

function mountSensorTable() {
    const tbody = document.getElementById("sensorTableBody");

    if (!tbody) {
        return;
    }

    const input = document.getElementById("sensorKeyword");
    const select = document.getElementById("sensorCategory");

    // Lưu điều kiện tìm kiếm đã được nhấn Search.
    let appliedKeyword = "";
    let appliedCategory = "All";

    const updateRows = createTableController({
        tbody,
        rows: sampleReadings,
        columns: 5,

        // Tạo một dòng dữ liệu cảm biến.
        renderRow: (r, n) => `
            <tr>
                <td>${n}</td>

                <td>
                    <span class="sensor-name">
                        <i class="sensor-dot ${r.sensor.toLowerCase()}"></i>
                        ${r.sensor}
                    </span>
                </td>

                <td><b>${r.value}</b></td>
                <td>${r.unit}</td>
                <td>${r.time}</td>
            </tr>
        `,

        // Lưu điều kiện hiện tại khi nhấn Search hoặc Reset.
        captureFilters: () => {
            appliedKeyword = input.value.trim().toLowerCase();
            appliedCategory = select.value;
        },

        // Điều kiện tìm kiếm dữ liệu.
        filterRows: r => {
            const q = appliedKeyword;
            const type = appliedCategory;

            // Temperature, Humidity, Light:
            // Chỉ tìm trong Value của loại cảm biến tương ứng.
            if (
                type === "Temperature" ||
                type === "Humidity" ||
                type === "Light"
            ) {
                return r.sensor === type &&
                    String(r.value).toLowerCase().includes(q);
            }

            // Time: chỉ tìm trong cột Time.
            if (type === "Time") {
                return String(r.time).toLowerCase().includes(q);
            }

            // All: tìm kiếm trên tất cả các cột dữ liệu.
            return [
                r.id,
                r.sensor,
                r.value,
                r.unit,
                r.time
            ].some(value =>
                String(value).toLowerCase().includes(q)
            );
        }
    });


    async function refreshSensorTable() {
        try {
            const result = await apiRequest("/sensor-data?limit=500");
            updateRows(result.data || []);

        } catch (error) {
            console.error("Không tải được dữ liệu cảm biến:", error.message);
        }
    }

    refreshSensorTable();
    window.setInterval(refreshSensorTable, 3000);
}


// ==============================
// ACTIVITY HISTORY TABLE
// Bảng lịch sử hoạt động
// ==============================

function mountActivityTable() {
    const tbody = document.getElementById("activityTableBody");

    if (!tbody) {
        return;
    }

    const time = document.getElementById("activityTimeKeyword");
    const device = document.getElementById("activityDeviceFilter");
    const action = document.getElementById("activityActionFilter");
    const status = document.getElementById("activityStatusFilter");

    // Lưu điều kiện lọc đã được nhấn Search.
    let appliedTime = "";
    let appliedDevice = "All";
    let appliedAction = "All";
    let appliedStatus = "All";

    const updateRows = createTableController({
        tbody,
        rows: sampleActivityLog,
        columns: 6,

        // Tạo một dòng lịch sử hoạt động.
        renderRow: (r, n) => `
            <tr>
                <td>${n}</td>
                <td><b>${r.user}</b></td>
                <td>${r.device}</td>

                <td>
                    <span class="action ${r.action.toLowerCase()}">
                        ${r.action}
                    </span>
                </td>

                <td>
                    <span class="status ${r.status.toLowerCase()}">
                        ${r.status}
                    </span>
                </td>

                <td>${new Date(r.time).toLocaleString("vi-VN")}</td>
            </tr>
        `,

        // Lưu các điều kiện khi nhấn Search hoặc Reset.
        captureFilters: () => {
            appliedTime = time.value.trim().toLowerCase();
            appliedDevice = device.value;
            appliedAction = action.value;
            appliedStatus = status.value;
        },

        // Điều kiện lọc lịch sử hoạt động.
        filterRows: r => {
            const keyword = appliedTime;

            const formattedTime = new Date(r.time)
                .toLocaleString("vi-VN")
                .toLowerCase();

            // Time: chỉ tìm trong cột thời gian.
            const matchTime =
                !keyword ||
                String(r.time).toLowerCase().includes(keyword) ||
                formattedTime.includes(keyword);

            // Device: lọc theo thiết bị được chọn.
            const matchDevice =
                appliedDevice === "All" ||
                r.device === appliedDevice;

            // Action: lọc theo hành động được chọn.
            const matchAction =
                appliedAction === "All" ||
                r.action === appliedAction;

            // Status: lọc theo trạng thái được chọn.
            const matchStatus =
                appliedStatus === "All" ||
                r.status === appliedStatus;

            // Tất cả điều kiện phải đồng thời thỏa mãn.
            return matchTime &&
                matchDevice &&
                matchAction &&
                matchStatus;
        }
    });


    async function refreshActivityTable() {
        try {
            const result = await apiRequest("/activity");
            updateRows(result.data || []);

        } catch (error) {
            console.error("Không tải được lịch sử:", error.message);
        }
    }

    refreshActivityTable();
    window.setInterval(refreshActivityTable, 3000);
}


// ==============================
// DASHBOARD CHARTS
// Biểu đồ dữ liệu cảm biến thật
// Tự cập nhật 3 giây/lần
// ==============================

function mountDashboardView() {
    const dashboard = document.querySelector(".dashboard-content");

    if (!dashboard) {
        return;
    }

    const ranges = {
        today: [
            "00", "02", "04", "06", "08", "10",
            "12", "14", "16", "18", "20", "22"
        ],

        "7days": [
            "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"
        ],

        month: [
            "1", "4", "7", "10", "13",
            "16", "19", "22", "25", "30"
        ]
    };


    // Cấu hình các biểu đồ.
    const configs = [
        {
            key: "temperature",
            id: "temperatureChart",
            current: "temperatureCurrent",
            min: "temperatureMin",
            max: "temperatureMax",
            summary: "temperatureSummary",
            unit: "°C",
            base: 28.5,
            variation: 3,
            color: "#bd5a55",
            precision: 1
        },

        {
            key: "humidity",
            id: "humidityChart",
            current: "humidityCurrent",
            min: "humidityMin",
            max: "humidityMax",
            summary: "humiditySummary",
            unit: "%",
            base: 72,
            variation: 12,
            color: "#718da9",
            precision: 0
        },

        {
            key: "light",
            id: "lightChart",
            current: "lightCurrent",
            min: "lightMin",
            max: "lightMax",
            summary: "lightSummary",
            unit: "ADC",
            base: 650,
            variation: 250,
            color: "#c69b43",
            precision: 0
        }
    ];


    let range = "today";
    const store = {};


    // Tạo dữ liệu biểu đồ.
    function makeValues() {
        return [];
    }


    // Vẽ biểu đồ và cập nhật thông số.
    function render(c) {
        const svg = document.getElementById(c.id);

        if (!svg) {
            return;
        }

        const values = store[c.key] || (store[c.key] = makeValues());

        if (!values.length) {
            svg.innerHTML = `
                <text
                    x="250"
                    y="105"
                    text-anchor="middle"
                    fill="#8c897f"
                    font-size="14"
                >
                    Waiting for sensor data...
                </text>
            `;

            document.getElementById(c.current).textContent = `-- ${c.unit}`;
            document.getElementById(c.min).textContent = `Min -- ${c.unit}`;
            document.getElementById(c.max).textContent = `Max -- ${c.unit}`;
            document.getElementById(c.summary).innerHTML = `-- <small>${c.unit}</small>`;

            return;
        }

        const w = 500;
        const h = 210;
        const left = 42;
        const right = 12;
        const top = 12;
        const bottom = 30;

        const min = Math.min(...values) - c.variation * .18;
        const max = Math.max(...values) + c.variation * .18;

        const x = i =>
            left + i / (values.length - 1 || 1) * (w - left - right);

        const y = v =>
            top + (max - v) / (max - min || 1) * (h - top - bottom);

        const pts = values
            .map((v, i) => `${x(i)},${y(v)}`)
            .join(" ");


        // Tạo các đường lưới.
        let grid = "";

        for (let i = 0; i < 5; i++) {
            const gy = top + i * (h - top - bottom) / 4;

            grid += `
                <line
                    x1="${left}"
                    y1="${gy}"
                    x2="${w - right}"
                    y2="${gy}"
                    stroke="#e8e4da"
                    stroke-dasharray="3 5"
                />
            `;
        }


        // Tạo nhãn trên trục thời gian.
        const labels = ranges[range]
            .map((v, i) => `
                <text
                    x="${x(i)}"
                    y="${h - 7}"
                    text-anchor="middle"
                    fill="#8c897f"
                    font-size="10"
                >
                    ${v}
                </text>
            `)
            .join("");


        // Hiển thị đường biểu đồ.
        svg.innerHTML = `
            ${grid}

            <polyline
                points="${pts}"
                fill="none"
                stroke="${c.color}"
                stroke-width="3"
                stroke-linecap="round"
                stroke-linejoin="round"
            />

            ${values.map((v, i) => `
                <circle
                    cx="${x(i)}"
                    cy="${y(v)}"
                    r="3"
                    fill="${c.color}"
                />
            `).join("")}

            ${labels}
        `;


        // Cập nhật giá trị hiện tại.
        const current = values[values.length - 1];

        document.getElementById(c.current).textContent = `${current} ${c.unit}`;
        document.getElementById(c.min).textContent = `Min ${Math.min(...values)} ${c.unit}`;
        document.getElementById(c.max).textContent = `Max ${Math.max(...values)} ${c.unit}`;

        const summary = document.getElementById(c.summary);

        summary.innerHTML = `${current} <small>${c.unit}</small>`;
    }


    // Vẽ lại toàn bộ biểu đồ.
    function redraw() {
        configs.forEach(render);
    }


    // Chọn khoảng thời gian hiển thị.
    document.querySelectorAll(".time-btn").forEach(b => {
        b.addEventListener("click", () => {
            range = b.dataset.range;

            document.querySelectorAll(".time-btn").forEach(x => {
                x.classList.toggle("active", x === b);
            });

            configs.forEach(c => {
                store[c.key] = makeValues(c);
            });

            redraw();
        });
    });


    redraw();


    // Lấy dữ liệu thật từ backend, cập nhật biểu đồ mỗi 3 giây.
    async function refreshSensorCharts() {
        try {
            const result = await apiRequest("/sensor-data?limit=500");
            const rows = result.data || [];

            const sensorNames = {
                temperature: "Temperature",
                humidity: "Humidity",
                light: "Light"
            };

            configs.forEach(config => {
                const values = rows
                    .filter(row => row.sensor === sensorNames[config.key])
                    .slice(0, 12)
                    .reverse()
                    .map(row => Number(row.value));

                if (values.length) {
                    store[config.key] = values;
                }
            });

            redraw();

        } catch (error) {
            console.warn("Chưa lấy được dữ liệu biểu đồ:", error.message);
        }
    }

    refreshSensorCharts();
    window.setInterval(refreshSensorCharts, 3000);


    // Hiển thị ngày hiện tại.
    const today = document.getElementById("todayLabel");

    if (today) {
        today.textContent = new Date().toLocaleDateString("vi-VN", {
            day: "2-digit",
            month: "long",
            year: "numeric"
        });
    }
}


// ==============================
// PROFILE
// Quản lý thông tin tài khoản
// ==============================

function renderAccountProfile() {
    const user = JSON.parse(
        localStorage.getItem("authUser") || "{}"
    );

    // Thông tin cá nhân
    const name = "Nguyễn Đức Minh";
    const msv = "B23DCCN555";
    const role = user.role ||
        localStorage.getItem("profileRole") ||
        "USER";

    // Hiển thị họ tên
    const profileName = document.getElementById("profileName");
    const profileFullName = document.getElementById("profileFullName");

    if (profileName) {
        profileName.textContent = name;
    }

    if (profileFullName) {
        profileFullName.textContent = name;
    }

    // Hiển thị MSV
    const profileMSV = document.getElementById("profileMSV");

    if (profileMSV) {
        profileMSV.textContent = msv;
    }

    // Hiển thị Role
    const profileRole = document.getElementById("profileRole");
    const profileRoleDetail = document.getElementById("profileRoleDetail");

    if (profileRole) {
        profileRole.textContent = role;
    }

    if (profileRoleDetail) {
        profileRoleDetail.textContent = role;
    }

    // Các liên kết cá nhân
    const profileGithub = document.getElementById("profileGithub");
    const profileFigma = document.getElementById("profileFigma");
    const profileDocument = document.getElementById("profileDocument");

    if (profileGithub) {
        profileGithub.href = "#";
    }

    if (profileFigma) {
        profileFigma.href = "#";
    }

    if (profileDocument) {
        profileDocument.href = "#";
    }
}

function updateAccountProfile() {
    const current = localStorage.getItem("profileName") || "Admin User";

    const name = prompt("Nhập họ và tên:", current);

    if (name === null) {
        return;
    }

    const role = prompt(
        "Nhập chức vụ:",
        localStorage.getItem("profileRole") || "Administrator"
    );

    if (role === null) {
        return;
    }

    if (!name.trim() || !role.trim()) {
        alert("Thông tin không được để trống!");
        return;
    }

    localStorage.setItem("profileName", name.trim());
    localStorage.setItem("profileRole", role.trim());

    renderAccountProfile();

    alert("Cập nhật thông tin thành công!");
}


function requestPasswordChange() {
    alert(
        "Chức năng đổi mật khẩu cần được kết nối với hệ thống đăng nhập " +
        "để xác thực mật khẩu hiện tại và lưu mật khẩu mới an toàn."
    );
}


// ==============================
// INITIALIZE APPLICATION
// Khởi tạo các chức năng khi tải trang
// ==============================


// ==============================
// INITIALIZE APPLICATION
// Khởi tạo các chức năng khi tải trang
// ==============================

document.addEventListener("DOMContentLoaded", () => {
    const isLoginPage = document.body.classList.contains("login-page");
    const token = localStorage.getItem("authToken");

    // Nếu chưa đăng nhập và không ở trang đăng nhập,
    // chuyển người dùng về trang đăng nhập.
    if (!isLoginPage && !token) {
        window.location.replace("index.html");
        return;
    }

    // Nếu đã có token và đang ở trang đăng nhập,
    // chuyển sang Dashboard.
    if (isLoginPage && token) {
        window.location.replace("dashboard.html");
        return;
    }

    // Không chạy các chức năng cần xác thực trên trang đăng nhập.
    if (isLoginPage) {
        return;
    }

    // Khởi tạo chức năng dành cho người dùng đã đăng nhập.
    mountSensorTable();
    mountActivityTable();
    mountDashboardView();
    renderAccountProfile();

    refreshLedStates();
    window.setInterval(refreshLedStates, 3000);
});
