CREATE DATABASE IF NOT EXISTS iot_system
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE iot_system;

CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    username VARCHAR(50) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(120) NOT NULL,
    email VARCHAR(150) NULL,
    role ENUM('ADMIN', 'USER') NOT NULL DEFAULT 'USER',
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_users_username (username),
    UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sensor_data (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    temperature DECIMAL(7,2) NOT NULL,
    humidity DECIMAL(7,2) NOT NULL,
    light DECIMAL(10,2) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_sensor_created_at (created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS devices (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    device_code VARCHAR(30) NOT NULL,
    device_name VARCHAR(80) NOT NULL,
    device_type VARCHAR(30) NOT NULL,
    status TINYINT(1) NOT NULL DEFAULT 0,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_devices_code (device_code)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS activity_logs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NULL,
    username VARCHAR(50) NOT NULL DEFAULT 'ESP32',
    device VARCHAR(30) NOT NULL,
    action ENUM('ON', 'OFF') NOT NULL,
    status ENUM('SUCCESS', 'LOADING', 'FAILED') NOT NULL DEFAULT 'SUCCESS',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_activity_created_at (created_at),
    KEY idx_activity_user_id (user_id),
    CONSTRAINT fk_activity_user FOREIGN KEY (user_id)
        REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB;

INSERT INTO devices (device_code, device_name, device_type, status)
VALUES ('LED 01', 'LED 01', 'LED', 0), ('LED 02', 'LED 02', 'LED', 0)
ON DUPLICATE KEY UPDATE device_name = VALUES(device_name);

-- Chay `npm run seed:admin` trong thu muc backend de tao tai khoan admin.
