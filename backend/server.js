require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const mqtt = require('mqtt');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const MQTT_HOST = process.env.MQTT_HOST || '192.168.1.36';
const MQTT_PORT = Number(process.env.MQTT_PORT || 1884);
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

if (!JWT_SECRET || JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET phải được cấu hình và có ít nhất 32 ký tự trong file .env');
}

app.use(cors());
app.use(express.json());

const db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'iot_system',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    timezone: 'Z'
});

const ledState = { 1: false, 2: false };
let mqttConnected = false;
const pendingCommands = [];

function authenticateToken(req, res, next) {
    const authorization = req.headers.authorization || '';
    const token = authorization.startsWith('Bearer ')
        ? authorization.slice(7)
        : null;

    if (!token) {
        return res.status(401).json({ success: false, message: 'Vui lòng đăng nhập.' });
    }

    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch (error) {
        return res.status(401).json({ success: false, message: 'Token không hợp lệ hoặc đã hết hạn.' });
    }
}

async function saveSensorData(data) {
    await db.execute(
        `INSERT INTO sensor_data (temperature, humidity, light, created_at)
         VALUES (?, ?, ?, UTC_TIMESTAMP())`,
        [data.temperature, data.humidity, data.light]
    );
}

async function saveActivity(device, action, status = 'SUCCESS', user = null) {
    await db.execute(
        `INSERT INTO activity_logs (user_id, username, device, action, status, created_at)
         VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
        [user?.id || null, user?.username || 'ESP32', device, action, status]
    );
}

async function updateDeviceState(number, isOn) {
    await db.execute(
        `INSERT INTO devices (device_code, device_name, device_type, status)
         VALUES (?, ?, 'LED', ?)
         ON DUPLICATE KEY UPDATE status = VALUES(status), updated_at = CURRENT_TIMESTAMP`,
        [`LED 0${number}`, `LED 0${number}`, isOn ? 1 : 0]
    );
}

const mqttUrl = `mqtt://${MQTT_HOST}:${MQTT_PORT}`;
const mqttClient = mqtt.connect(mqttUrl, {
    username: process.env.MQTT_USERNAME || undefined,
    password: process.env.MQTT_PASSWORD || undefined,
    clientId: `iot_backend_${Math.random().toString(16).slice(2, 10)}`,
    reconnectPeriod: 3000,
    connectTimeout: 10000
});

mqttClient.on('connect', () => {
    mqttConnected = true;
    console.log(`MQTT connected: ${mqttUrl}`);
    mqttClient.subscribe(['home/sensor', 'home/led/history', 'home/led/state'], error => {
        if (error) console.error('MQTT subscribe error:', error.message);
        else console.log('Subscribed: home/sensor, home/led/history, home/led/state');
    });
});

mqttClient.on('reconnect', () => console.log('Reconnecting to MQTT...'));
mqttClient.on('close', () => { mqttConnected = false; });
mqttClient.on('error', error => console.error('MQTT error:', error.message));

mqttClient.on('message', async (topic, payload) => {
    const message = payload.toString();

    if (topic === 'home/sensor') {
        try {
            const data = JSON.parse(message);
            const values = [Number(data.temperature), Number(data.humidity), Number(data.light)];
            if (values.every(Number.isFinite)) {
                await saveSensorData({ temperature: values[0], humidity: values[1], light: values[2] });
            }
        } catch (error) {
            console.error('Không lưu được dữ liệu cảm biến:', error.message);
        }
        return;
    }

    if (topic === 'home/led/state') {
        try {
            const state = JSON.parse(message);
            if (typeof state.led1 === 'boolean') {
                ledState[1] = state.led1;
                await updateDeviceState(1, state.led1);
            }
            if (typeof state.led2 === 'boolean') {
                ledState[2] = state.led2;
                await updateDeviceState(2, state.led2);
            }
        } catch (error) {
            console.error('Không cập nhật được trạng thái LED:', error.message);
        }
        return;
    }

    if (topic === 'home/led/history') {
        try {
            const match = message.match(/^(LED 1|LED 2|ALL LED) (ON|OFF)$/);
            if (!match) return;

            const [, target, action] = match;
            const isOn = action === 'ON';
            const device = target === 'ALL LED'
                ? 'ALL LED'
                : target.replace('LED 1', 'LED 01').replace('LED 2', 'LED 02');

            if (target === 'LED 1') {
                ledState[1] = isOn;
                await updateDeviceState(1, isOn);
            } else if (target === 'LED 2') {
                ledState[2] = isOn;
                await updateDeviceState(2, isOn);
            } else {
                ledState[1] = isOn;
                ledState[2] = isOn;
                await updateDeviceState(1, isOn);
                await updateDeviceState(2, isOn);
            }

            const now = Date.now();
            const pendingIndex = pendingCommands.findIndex(item =>
                item.expiresAt > now && item.action === action &&
                (target === 'ALL LED' ? item.target === 'ALL LED' : item.target === target)
            );
            const pending = pendingIndex >= 0 ? pendingCommands.splice(pendingIndex, 1)[0] : null;
            await saveActivity(device, action, 'SUCCESS', pending?.user || null);
        } catch (error) {
            console.error('Không xử lý được lịch sử MQTT:', error.message);
        }
    }
});

app.get('/api/health', (req, res) => {
    res.json({ success: true, mqttConnected, mqttHost: MQTT_HOST, mqttPort: MQTT_PORT, database: 'connected' });
});

app.post('/api/auth/sign-in', async (req, res) => {
    try {
        const username = String(req.body?.username || '').trim();
        const password = String(req.body?.password || '');

        if (!username || !password) {
            return res.status(400).json({ success: false, message: 'Vui lòng nhập tên đăng nhập và mật khẩu.' });
        }

        const [users] = await db.execute(
            `SELECT id, username, password_hash, full_name, email, role
             FROM users WHERE username = ? AND is_active = 1 LIMIT 1`,
            [username]
        );

        if (!users.length || !(await bcrypt.compare(password, users[0].password_hash))) {
            return res.status(401).json({ success: false, message: 'Tên đăng nhập hoặc mật khẩu không đúng.' });
        }

        const user = users[0];
        const payload = {
            id: user.id,
            username: user.username,
            fullName: user.full_name,
            email: user.email,
            role: user.role
        };
        const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

        res.json({ success: true, token, expiresIn: JWT_EXPIRES_IN, user: payload });
    } catch (error) {
        console.error('Login error:', error.message);
        res.status(500).json({ success: false, message: 'Không thể đăng nhập lúc này.' });
    }
});

app.use('/api', (req, res, next) => {
    if (req.path === '/health' || req.path === '/auth/sign-in') return next();
    authenticateToken(req, res, next);
});

app.get('/api/dashboard/led', (req, res) => {
    res.json({ success: true, leds: { led1: ledState[1], led2: ledState[2] }, mqttConnected });
});

app.post('/api/dashboard/control', async (req, res) => {
    const ledNumber = Number(req.body?.target_number);
    const power = String(req.body?.action);

    if (![1, 2].includes(ledNumber) || !['0', '1'].includes(power)) {
        return res.status(400).json({ success: false, message: 'target_number phải là 1 hoặc 2; action phải là 0 hoặc 1.' });
    }
    if (!mqttConnected) {
        return res.status(503).json({ success: false, message: 'Backend chưa kết nối được MQTT broker.' });
    }

    const action = power === '1' ? 'ON' : 'OFF';
    const target = `LED ${ledNumber}`;
    const pending = { target, action, user: req.user, expiresAt: Date.now() + 15000 };
    pendingCommands.push(pending);
    mqttClient.publish(`home/led/${ledNumber}`, power, { qos: 1 }, error => {
        if (error) {
            const index = pendingCommands.indexOf(pending);
            if (index >= 0) pendingCommands.splice(index, 1);
            return res.status(502).json({ success: false, message: 'Không gửi được lệnh MQTT.' });
        }
        res.json({ success: true, message: 'Đã gửi lệnh đến ESP32.', target_number: ledNumber, action: Number(power) });
    });
});

app.post('/api/dashboard/control/all', (req, res) => {
    const power = String(req.body?.action);
    if (!['0', '1'].includes(power)) return res.status(400).json({ success: false, message: 'action phải là 0 hoặc 1.' });
    if (!mqttConnected) return res.status(503).json({ success: false, message: 'Backend chưa kết nối được MQTT broker.' });

    const action = power === '1' ? 'ON' : 'OFF';
    const pending = { target: 'ALL LED', action, user: req.user, expiresAt: Date.now() + 15000 };
    pendingCommands.push(pending);
    mqttClient.publish('home/led/all', power, { qos: 1 }, error => {
        if (error) {
            const index = pendingCommands.indexOf(pending);
            if (index >= 0) pendingCommands.splice(index, 1);
            return res.status(502).json({ success: false, message: 'Không gửi được lệnh MQTT.' });
        }
        res.json({ success: true, message: 'Đã gửi lệnh điều khiển cả hai LED.' });
    });
});

app.get('/api/sensor-data', async (req, res) => {
    try {
        const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 1000);
        const sensor = String(req.query.sensor || 'All');
        const allowedSensors = ['Temperature', 'Humidity', 'Light'];
        if (sensor !== 'All' && !allowedSensors.includes(sensor)) {
            return res.status(400).json({ success: false, message: 'Loại cảm biến không hợp lệ.' });
        }

        const sensorFilter = sensor === 'All' ? '' : 'WHERE sensor = ?';
        const query = `
            SELECT id, sensor, value, unit, created_at AS time FROM (
                SELECT id * 3 AS id, 'Temperature' AS sensor, temperature AS value, '°C' AS unit, created_at FROM sensor_data
                UNION ALL
                SELECT id * 3 + 1 AS id, 'Humidity' AS sensor, humidity AS value, '%' AS unit, created_at FROM sensor_data
                UNION ALL
                SELECT id * 3 + 2 AS id, 'Light' AS sensor, light AS value, 'ADC' AS unit, created_at FROM sensor_data
            ) AS readings
            ${sensorFilter}
            ORDER BY created_at DESC, id DESC
            LIMIT ?`;
        const params = sensor === 'All' ? [limit] : [sensor, limit];
        const [dataRows] = await db.execute(query, params);
        const [latestRows] = await db.execute(
            'SELECT temperature, humidity, light, created_at FROM sensor_data ORDER BY created_at DESC, id DESC LIMIT 1'
        );
        const latest = latestRows.length ? {
            temperature: latestRows[0].temperature,
            humidity: latestRows[0].humidity,
            light: latestRows[0].light,
            time: new Date(latestRows[0].created_at).toISOString()
        } : null;
        const data = dataRows.map(row => ({
            id: row.id,
            sensor: row.sensor,
            value: row.value,
            unit: row.unit,
            time: new Date(row.time).toISOString()
        }));
        res.json({ success: true, latest, data });
    } catch (error) {
        console.error('Sensor query error:', error.message);
        res.status(500).json({ success: false, message: 'Không lấy được dữ liệu cảm biến.' });
    }
});

app.get('/api/activity', async (req, res) => {
    try {
        const [rows] = await db.execute(
            `SELECT id, username AS user, device, action, status, created_at AS time
             FROM activity_logs ORDER BY created_at DESC, id DESC LIMIT 500`
        );
        res.json({ success: true, data: rows.map(row => ({ ...row, time: new Date(row.time).toISOString() })) });
    } catch (error) {
        console.error('Activity query error:', error.message);
        res.status(500).json({ success: false, message: 'Không lấy được lịch sử hoạt động.' });
    }
});

app.get('/api/iot-devices', async (req, res) => {
    try {
        const [rows] = await db.execute('SELECT device_code, device_name, device_type, status, updated_at FROM devices ORDER BY id');
        res.json({ success: true, data: rows });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Không lấy được danh sách thiết bị.' });
    }
});

app.use(express.static(path.join(__dirname, '..', 'frontend')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html')));

async function startServer() {
    try {
        const connection = await db.getConnection();
        await connection.ping();
        connection.release();
        const [savedDevices] = await db.execute(
            "SELECT device_code, status FROM devices WHERE device_code IN ('LED 01', 'LED 02')"
        );
        savedDevices.forEach(device => {
            const number = device.device_code === 'LED 01' ? 1 : 2;
            ledState[number] = Boolean(device.status);
        });
        console.log('MySQL connected.');
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`IoT System is running at http://localhost:${PORT}`);
            console.log(`MQTT broker: ${mqttUrl}`);
        });
    } catch (error) {
        console.error('Không thể kết nối MySQL:', error.message);
        console.error('Kiểm tra MySQL và cấu hình DB_* trong file .env.');
        process.exit(1);
    }
}

process.on('SIGINT', async () => {
    mqttClient.end(true);
    await db.end();
    process.exit(0);
});

startServer();
