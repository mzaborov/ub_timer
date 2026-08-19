-- ub-timer / u10190_ubtimer
-- Канон: docs/планы/05_доменная_модель.yaml
-- Имена таблиц — черновик плана 05; статусы/типы — значения домена (не visibility).
-- Нет UNIQUE(ФИО), нет UNIQUE(код ситуации).
-- ТОЛЬКО первая установка / пустая БД / load_domain_mysql.py --fresh.
-- Обычная заливка схема не гоняет: DROP TABLE здесь уничтожит живые заявки.

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS material_docs;
DROP TABLE IF EXISTS protocol_events;
DROP TABLE IF EXISTS duel_change_log;
DROP TABLE IF EXISTS videos;
DROP TABLE IF EXISTS duel_judges;
DROP TABLE IF EXISTS duels;
DROP TABLE IF EXISTS meeting_registrations;
DROP TABLE IF EXISTS event_observers;
DROP TABLE IF EXISTS event_organizers;
DROP TABLE IF EXISTS events;
DROP TABLE IF EXISTS situations;
DROP TABLE IF EXISTS circle_memberships;
DROP TABLE IF EXISTS circles;
DROP TABLE IF EXISTS people;

CREATE TABLE people (
  id INT NOT NULL AUTO_INCREMENT,
  full_name VARCHAR(191) NOT NULL,
  email VARCHAR(191) NULL,
  telegram VARCHAR(64) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  notes TEXT NULL,
  PRIMARY KEY (id),
  KEY idx_people_name (full_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE circles (
  id INT NOT NULL AUTO_INCREMENT,
  title VARCHAR(191) NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE circle_memberships (
  id INT NOT NULL AUTO_INCREMENT,
  circle_id INT NOT NULL,
  person_id INT NOT NULL,
  involvement VARCHAR(191) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_cm_circle (circle_id),
  KEY idx_cm_person (person_id),
  CONSTRAINT fk_cm_circle FOREIGN KEY (circle_id) REFERENCES circles (id),
  CONSTRAINT fk_cm_person FOREIGN KEY (person_id) REFERENCES people (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE situations (
  id INT NOT NULL AUTO_INCREMENT,
  code VARCHAR(191) NOT NULL,
  num INT NULL,
  duel_type VARCHAR(32) NOT NULL COMMENT 'классика|экспресс|парный',
  description MEDIUMTEXT NULL,
  roles_json MEDIUMTEXT NULL,
  is_published TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  KEY idx_sit_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE events (
  id INT NOT NULL AUTO_INCREMENT,
  slug VARCHAR(64) NULL,
  title VARCHAR(255) NOT NULL,
  event_type VARCHAR(32) NOT NULL COMMENT 'онлайн|купала|новогоднее|региональный|турнир',
  starts_on DATE NULL,
  ends_on DATE NULL,
  starts_at TIME NULL COMMENT 'МСК; онлайн по умолчанию 11:00',
  ends_at TIME NULL COMMENT 'МСК; онлайн по умолчанию 13:30',
  status VARCHAR(32) NOT NULL COMMENT 'Запланировано|Подготовка|Проведено|Отменено',
  zoom_url VARCHAR(1024) NULL,
  referee_person_id INT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_events_slug (slug),
  KEY idx_events_type (event_type),
  CONSTRAINT fk_events_referee FOREIGN KEY (referee_person_id) REFERENCES people (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE event_organizers (
  id INT NOT NULL AUTO_INCREMENT,
  event_id INT NOT NULL,
  person_id INT NOT NULL,
  role VARCHAR(64) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_org_event_person_role (event_id, person_id, role),
  KEY idx_org_person (person_id),
  CONSTRAINT fk_org_event FOREIGN KEY (event_id) REFERENCES events (id),
  CONSTRAINT fk_org_person FOREIGN KEY (person_id) REFERENCES people (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE event_observers (
  id INT NOT NULL AUTO_INCREMENT,
  event_id INT NOT NULL,
  person_id INT NOT NULL,
  PRIMARY KEY (id),
  KEY idx_obs_event (event_id),
  CONSTRAINT fk_obs_event FOREIGN KEY (event_id) REFERENCES events (id),
  CONSTRAINT fk_obs_person FOREIGN KEY (person_id) REFERENCES people (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE meeting_registrations (
  id INT NOT NULL AUTO_INCREMENT,
  event_id INT NOT NULL,
  person_id INT NULL,
  full_name VARCHAR(191) NOT NULL,
  email VARCHAR(191) NULL,
  telegram VARCHAR(64) NULL,
  wants_play TINYINT(1) NOT NULL DEFAULT 0,
  wants_judge TINYINT(1) NOT NULL DEFAULT 0,
  wants_second TINYINT(1) NOT NULL DEFAULT 0,
  comment TEXT NULL,
  source VARCHAR(64) NULL,
  PRIMARY KEY (id),
  KEY idx_reg_event (event_id),
  CONSTRAINT fk_reg_event FOREIGN KEY (event_id) REFERENCES events (id),
  CONSTRAINT fk_reg_person FOREIGN KEY (person_id) REFERENCES people (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE duels (
  id INT NOT NULL AUTO_INCREMENT,
  event_id INT NOT NULL,
  sort_order INT NOT NULL,
  duel_date DATE NULL,
  duel_type VARCHAR(32) NOT NULL,
  prep_mode VARCHAR(32) NOT NULL,
  round_minutes TINYINT NOT NULL,
  situation_id INT NULL,
  player1_id INT NULL,
  second1_id INT NULL,
  player2_id INT NULL,
  second2_id INT NULL,
  referee_qty INT NULL,
  notes TEXT NULL,
  PRIMARY KEY (id),
  KEY idx_duels_event (event_id, sort_order),
  CONSTRAINT fk_duels_event FOREIGN KEY (event_id) REFERENCES events (id),
  CONSTRAINT fk_duels_situation FOREIGN KEY (situation_id) REFERENCES situations (id),
  CONSTRAINT fk_duels_p1 FOREIGN KEY (player1_id) REFERENCES people (id),
  CONSTRAINT fk_duels_s1 FOREIGN KEY (second1_id) REFERENCES people (id),
  CONSTRAINT fk_duels_p2 FOREIGN KEY (player2_id) REFERENCES people (id),
  CONSTRAINT fk_duels_s2 FOREIGN KEY (second2_id) REFERENCES people (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE duel_judges (
  id INT NOT NULL AUTO_INCREMENT,
  duel_id INT NOT NULL,
  person_id INT NULL,
  college VARCHAR(64) NULL,
  vote VARCHAR(64) NULL,
  PRIMARY KEY (id),
  KEY idx_dj_duel (duel_id),
  CONSTRAINT fk_dj_duel FOREIGN KEY (duel_id) REFERENCES duels (id),
  CONSTRAINT fk_dj_person FOREIGN KEY (person_id) REFERENCES people (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE videos (
  id INT NOT NULL AUTO_INCREMENT,
  event_id INT NULL,
  duel_id INT NULL,
  situation_id INT NULL,
  url VARCHAR(1024) NOT NULL,
  video_date DATE NULL,
  title VARCHAR(255) NULL,
  video_type VARCHAR(32) NULL COMMENT 'ДеньЦеликом|Поединок|Разбор',
  PRIMARY KEY (id),
  KEY idx_vid_event (event_id),
  KEY idx_vid_duel (duel_id),
  KEY idx_vid_sit (situation_id),
  CONSTRAINT fk_vid_event FOREIGN KEY (event_id) REFERENCES events (id),
  CONSTRAINT fk_vid_duel FOREIGN KEY (duel_id) REFERENCES duels (id),
  CONSTRAINT fk_vid_sit FOREIGN KEY (situation_id) REFERENCES situations (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE protocol_events (
  id INT NOT NULL AUTO_INCREMENT,
  duel_id INT NOT NULL,
  seq_num INT NOT NULL,
  moment_sec INT NULL,
  event_type VARCHAR(64) NOT NULL,
  payload_json MEDIUMTEXT NULL,
  PRIMARY KEY (id),
  KEY idx_pe_duel (duel_id),
  CONSTRAINT fk_pe_duel FOREIGN KEY (duel_id) REFERENCES duels (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE duel_change_log (
  id INT NOT NULL AUTO_INCREMENT,
  duel_id INT NOT NULL,
  changed_at DATETIME NOT NULL,
  field_name VARCHAR(64) NOT NULL,
  old_value TEXT NULL,
  new_value TEXT NULL,
  author_id INT NULL,
  PRIMARY KEY (id),
  KEY idx_dcl_duel (duel_id),
  CONSTRAINT fk_dcl_duel FOREIGN KEY (duel_id) REFERENCES duels (id),
  CONSTRAINT fk_dcl_author FOREIGN KEY (author_id) REFERENCES people (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE material_docs (
  id INT NOT NULL AUTO_INCREMENT,
  title VARCHAR(255) NOT NULL,
  slug VARCHAR(191) NOT NULL,
  body_md MEDIUMTEXT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_visible TINYINT(1) NOT NULL DEFAULT 1,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mat_slug (slug),
  KEY idx_mat_sort (sort_order, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;
