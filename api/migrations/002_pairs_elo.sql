-- ub-timer / u10190_ubtimer
-- Изменение: generate-pairs-from-registrations (генерация пар из заявок + Elo)
-- ИНКРЕМЕНТАЛЬНАЯ миграция. НЕ пересоздаёт БД, не трогает данные.
-- Применять один раз. Повторный запуск ALTER/CREATE даст ошибку "already exists".
-- Канон: docs/планы/07_пары_из_заявок.md

SET NAMES utf8mb4;

-- Пометки орга в заявке (жёсткие запреты, видны только организатору).
-- org_no_play: участник снят с игры, но остаётся в заявках.
-- org_banned_types: типы поединка через запятую (классика,экспресс,парный); NULL/пусто = без запретов.
ALTER TABLE meeting_registrations
  ADD COLUMN org_no_play TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN org_banned_types VARCHAR(64) NULL;

-- Кэш метрики силы (Elo) для генерации пар.
CREATE TABLE person_elo (
  person_id INT NOT NULL,
  elo DOUBLE NOT NULL DEFAULT 1500,
  games INT NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (person_id),
  CONSTRAINT fk_elo_person FOREIGN KEY (person_id) REFERENCES people (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
