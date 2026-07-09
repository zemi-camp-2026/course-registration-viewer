-- 受講科目登録・閲覧システム: MySQL スキーマ定義
-- Docker 初回起動時に自動実行される

CREATE TABLE IF NOT EXISTS users (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    student_number VARCHAR(50)  NOT NULL UNIQUE,
    name           VARCHAR(255) NOT NULL,
    role           ENUM('student', 'teacher') NOT NULL DEFAULT 'student',
    grade          VARCHAR(10)  DEFAULT NULL,
    is_admin       TINYINT(1)   NOT NULL DEFAULT 0,
    password_hash  VARCHAR(255) DEFAULT NULL,
    is_active      TINYINT(1)   NOT NULL DEFAULT 1,
    created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS quarters (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    year       INT          NOT NULL,
    quarter    INT          NOT NULL CHECK (quarter BETWEEN 1 AND 4),
    label      VARCHAR(255) NOT NULL,
    start_date DATE         DEFAULT NULL,
    end_date   DATE         DEFAULT NULL,
    is_active  TINYINT(1)   NOT NULL DEFAULT 0,
    UNIQUE KEY uq_year_quarter (year, quarter)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS schedule_entries (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    user_id      INT          NOT NULL,
    quarter_id   INT          NOT NULL,
    day_of_week  INT          NOT NULL CHECK (day_of_week BETWEEN 1 AND 6),
    period       INT          NOT NULL CHECK (period BETWEEN 1 AND 5),
    subject_name VARCHAR(255) NOT NULL,
    created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_user_quarter_day_period (user_id, quarter_id, day_of_week, period),
    INDEX idx_entries_quarter (quarter_id),
    INDEX idx_entries_user_quarter (user_id, quarter_id),
    FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE,
    FOREIGN KEY (quarter_id) REFERENCES quarters(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
