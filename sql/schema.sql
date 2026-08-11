/*
  Call_Reason — Microsoft SQL Server schema (port from PostgreSQL)
  ==================================================================

  Source of truth: server/db.ts in this repo (the PostgreSQL CREATE TABLE /
  ALTER TABLE statements inside DB.init()). This file reproduces the FINAL
  shape of every table directly — it does not replay the incremental
  ALTER TABLE history, since this is a brand-new database.

  Type mapping used throughout:
    TEXT (id / foreign key / short code column)  -> NVARCHAR(100)
      Needed wherever the column is a primary key, a foreign key, or part of
      a UNIQUE constraint/index — SQL Server cannot index an (MAX) column.
    TEXT (free text: notes, comments, summaries) -> NVARCHAR(MAX)
    BOOLEAN                                      -> BIT
    INTEGER / SMALLINT                           -> INT / SMALLINT
    TIMESTAMPTZ                                  -> DATETIMEOFFSET(3)
    DATE                                         -> DATE
    JSONB                                        -> NVARCHAR(MAX)
                                                     (validate with ISJSON() at
                                                     the application layer; SQL
                                                     Server has JSON_VALUE /
                                                     JSON_QUERY functions for
                                                     reading it, no native type)
    now()                                        -> SYSDATETIMEOFFSET()
    ON DELETE RESTRICT                           -> omitted (SQL Server's
                                                     default FK behaviour is
                                                     NO ACTION, which is the
                                                     RESTRICT-equivalent)

  Every CREATE TABLE / CREATE INDEX is wrapped in an existence check so this
  script is idempotent and safe to re-run, mirroring the Postgres
  "IF NOT EXISTS" behaviour in db.ts.

  Run this once, top to bottom, against an empty database via SSMS.
*/

SET NOCOUNT ON;
GO

-- ==================================================================
-- Core operations tables
-- ==================================================================

IF OBJECT_ID('dbo.users', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.users (
    id              NVARCHAR(100)   NOT NULL PRIMARY KEY,
    full_name       NVARCHAR(MAX)   NOT NULL,
    name            NVARCHAR(MAX)   NULL,
    username        NVARCHAR(100)   NOT NULL,
    email           NVARCHAR(200)   NOT NULL,
    password_hash   NVARCHAR(MAX)   NOT NULL,
    role            NVARCHAR(50)    NOT NULL,
    level           INT             NULL,
    job_title       NVARCHAR(200)   NULL,
    team            NVARCHAR(100)   NULL,
    status          NVARCHAR(50)    NOT NULL,
    created_at      NVARCHAR(50)    NULL,
    updated_at      NVARCHAR(50)    NULL,
    created_by      NVARCHAR(100)   NULL,
    can_upload      BIT             NOT NULL DEFAULT (0),
    work_type       NVARCHAR(50)    NOT NULL DEFAULT ('both'),
    department      NVARCHAR(100)   NULL,
    shift_status    NVARCHAR(50)    NOT NULL DEFAULT ('off'),
    shift_started_at NVARCHAR(50)   NULL
  );
END
GO

IF OBJECT_ID('dbo.brands', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.brands (
    id          NVARCHAR(100) NOT NULL PRIMARY KEY,
    brand_name  NVARCHAR(200) NOT NULL
  );
END
GO

IF OBJECT_ID('dbo.categories', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.categories (
    id              NVARCHAR(100) NOT NULL PRIMARY KEY,
    category_name   NVARCHAR(200) NOT NULL
  );
END
GO

IF OBJECT_ID('dbo.branches', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.branches (
    id            NVARCHAR(100) NOT NULL PRIMARY KEY,
    branch_name   NVARCHAR(200) NOT NULL,
    brand         NVARCHAR(200) NULL
  );
END
GO

IF OBJECT_ID('dbo.interactions', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.interactions (
    id                    NVARCHAR(100) NOT NULL PRIMARY KEY,
    interaction_date      NVARCHAR(50)  NULL,
    interaction_time      NVARCHAR(50)  NULL,
    agent_id              NVARCHAR(100) NULL,
    agent_name            NVARCHAR(MAX) NULL,
    customer_name         NVARCHAR(MAX) NULL,
    customer_phone        NVARCHAR(100) NULL,
    interaction_type      NVARCHAR(100) NULL,
    communication_type    NVARCHAR(100) NULL,
    call_direction         NVARCHAR(50)  NULL,
    brand                 NVARCHAR(200) NULL,
    category               NVARCHAR(200) NULL,
    call_reason            NVARCHAR(200) NULL,
    order_number            NVARCHAR(100) NULL,
    branch                 NVARCHAR(200) NULL,
    team                    NVARCHAR(100) NULL,
    customer_type           NVARCHAR(100) NULL,
    call_from               NVARCHAR(100) NULL,
    aggregator_name          NVARCHAR(200) NULL,
    comments                 NVARCHAR(MAX) NULL,
    complaint_reason          NVARCHAR(200) NULL,
    fcr                       NVARCHAR(50)  NULL,
    priority                  NVARCHAR(50)  NULL,
    status                    NVARCHAR(50)  NULL,
    summary                   NVARCHAR(MAX) NULL,
    action_taken              NVARCHAR(MAX) NULL,
    follow_up_required        BIT           NOT NULL DEFAULT (0),
    follow_up_date            NVARCHAR(50)  NULL,
    follow_up_notes           NVARCHAR(MAX) NULL,
    attachments               NVARCHAR(MAX) NOT NULL DEFAULT ('[]'), -- JSON array, validate with ISJSON()
    created_at                NVARCHAR(50)  NULL
  );
END
GO

IF OBJECT_ID('dbo.audit_logs', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.audit_logs (
    id              NVARCHAR(100) NOT NULL PRIMARY KEY,
    [timestamp]     NVARCHAR(50)  NULL,
    operator_id     NVARCHAR(100) NULL,
    operator_name   NVARCHAR(MAX) NULL,
    operator_role   NVARCHAR(50)  NULL,
    category        NVARCHAR(100) NULL,
    [action]        NVARCHAR(200) NULL,
    details         NVARCHAR(MAX) NULL,
    related_ref     NVARCHAR(200) NULL,
    ip_address      NVARCHAR(100) NULL,
    department      NVARCHAR(100) NULL,
    previous_value  NVARCHAR(MAX) NULL,
    new_value       NVARCHAR(MAX) NULL
  );
END
GO

IF OBJECT_ID('dbo.options', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.options (
    id          NVARCHAR(100) NOT NULL PRIMARY KEY,
    list_key    NVARCHAR(100) NOT NULL,
    label       NVARCHAR(300) NOT NULL,
    sort_order  INT           NOT NULL DEFAULT (0),
    active      BIT           NOT NULL DEFAULT (1)
  );
END
GO

IF OBJECT_ID('dbo.assigned_tasks', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.assigned_tasks (
    id                    NVARCHAR(100) NOT NULL PRIMARY KEY,
    title                 NVARCHAR(300) NOT NULL,
    description           NVARCHAR(MAX) NULL,
    assigned_by           NVARCHAR(100) NULL,
    assigned_by_name      NVARCHAR(MAX) NULL,
    assigned_to           NVARCHAR(100) NULL,
    assigned_to_name      NVARCHAR(MAX) NULL,
    department            NVARCHAR(100) NULL,
    priority              NVARCHAR(50)  NULL,
    due_date              NVARCHAR(50)  NULL,
    status                NVARCHAR(50)  NOT NULL DEFAULT ('New'),
    seen                  BIT           NOT NULL DEFAULT (0),
    duration_seconds      INT           NOT NULL DEFAULT (0),
    note                  NVARCHAR(MAX) NULL,
    created_at            NVARCHAR(50)  NULL,
    updated_at            NVARCHAR(50)  NULL,
    completed_at          NVARCHAR(50)  NULL,
    template_id           NVARCHAR(100) NULL,
    task_date             NVARCHAR(50)  NULL,
    require_time_entry    BIT           NOT NULL DEFAULT (1)
  );
END
GO

IF OBJECT_ID('dbo.recurring_templates', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.recurring_templates (
    id                NVARCHAR(100) NOT NULL PRIMARY KEY,
    title             NVARCHAR(300) NOT NULL,
    description       NVARCHAR(MAX) NULL,
    department        NVARCHAR(100) NULL,
    priority          NVARCHAR(50)  NOT NULL DEFAULT ('Medium'),
    recurrence_type   NVARCHAR(50)  NOT NULL DEFAULT ('daily'),
    days_of_week      NVARCHAR(100) NULL,
    due_time          NVARCHAR(50)  NULL,
    assign_mode       NVARCHAR(50)  NOT NULL DEFAULT ('pool'),
    active            BIT           NOT NULL DEFAULT (1),
    created_by        NVARCHAR(100) NULL,
    created_by_name   NVARCHAR(MAX) NULL,
    created_at        NVARCHAR(50)  NULL
  );
END
GO

IF OBJECT_ID('dbo.shift_sessions', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.shift_sessions (
    id                NVARCHAR(100) NOT NULL PRIMARY KEY,
    user_id           NVARCHAR(100) NULL,
    user_name         NVARCHAR(MAX) NULL,
    department        NVARCHAR(100) NULL,
    started_at        NVARCHAR(50)  NULL,
    ended_at          NVARCHAR(50)  NULL,
    duration_seconds  INT           NOT NULL DEFAULT (0)
  );
END
GO

IF OBJECT_ID('dbo.logs', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.logs (
    id                  NVARCHAR(100) NOT NULL PRIMARY KEY,
    log_type            NVARCHAR(50)  NOT NULL,
    department          NVARCHAR(100) NULL,
    activity_type       NVARCHAR(200) NULL,
    status              NVARCHAR(50)  NULL,
    agent_id            NVARCHAR(100) NULL,
    agent_name          NVARCHAR(MAX) NULL,
    branch              NVARCHAR(200) NULL,
    brand               NVARCHAR(200) NULL,
    order_number        NVARCHAR(100) NULL,
    aggregator          NVARCHAR(200) NULL,
    customer_name       NVARCHAR(MAX) NULL,
    complaint_id        NVARCHAR(200) NULL,
    target_agent_name   NVARCHAR(MAX) NULL,
    notes               NVARCHAR(MAX) NULL,
    action_taken        NVARCHAR(MAX) NULL,
    resolution_notes    NVARCHAR(MAX) NULL,
    action_plan         NVARCHAR(MAX) NULL,
    follow_up_date      NVARCHAR(50)  NULL,
    started_at          NVARCHAR(50)  NULL,
    duration_seconds    INT           NOT NULL DEFAULT (0),
    running_since       NVARCHAR(50)  NULL,
    created_at          NVARCHAR(50)  NULL,
    updated_at          NVARCHAR(50)  NULL,
    created_by          NVARCHAR(100) NULL,
    calls_reviewed      INT           NULL
  );
END
GO

-- ==================================================================
-- Ratings / Reviews module
-- ==================================================================

IF OBJECT_ID('dbo.platforms', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.platforms (
    id    NVARCHAR(100) NOT NULL PRIMARY KEY,
    name  NVARCHAR(200) NOT NULL,
    CONSTRAINT uq_platforms_name UNIQUE (name)
  );
END
GO

IF OBJECT_ID('dbo.ratings', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.ratings (
    id                 NVARCHAR(100)      NOT NULL PRIMARY KEY,
    brand_id           NVARCHAR(100)      NOT NULL,
    platform_id        NVARCHAR(100)      NOT NULL,
    order_id           NVARCHAR(150)      NOT NULL,
    rating             SMALLINT           NOT NULL,
    review_text        NVARCHAR(MAX)      NULL,
    customer_phone     NVARCHAR(100)      NULL,
    requires_action    BIT                NOT NULL DEFAULT (0),
    action_status      NVARCHAR(50)       NOT NULL DEFAULT ('pending'),
    assigned_agent_id  NVARCHAR(100)      NULL,
    action_note        NVARCHAR(MAX)      NULL,
    uploaded_by        NVARCHAR(100)      NULL,
    uploaded_at        DATETIMEOFFSET(3)  NOT NULL DEFAULT (SYSDATETIMEOFFSET()),
    resolved_at        DATETIMEOFFSET(3)  NULL,
    recorded_by        NVARCHAR(100)      NULL,
    recorded_at        DATETIMEOFFSET(3)  NULL,
    order_date         NVARCHAR(50)       NULL,
    customer_name      NVARCHAR(MAX)      NULL,
    branch             NVARCHAR(200)      NULL,
    filled_by          NVARCHAR(200)      NULL,
    following_date     NVARCHAR(50)       NULL,
    surveyed_by        NVARCHAR(200)      NULL,
    complaint_type     NVARCHAR(200)      NULL,
    complaint_cases    NVARCHAR(MAX)      NULL,
    complaint_status   NVARCHAR(100)      NULL,
    served_by          NVARCHAR(200)      NULL,
    note               NVARCHAR(MAX)      NULL,
    CONSTRAINT ck_ratings_rating CHECK (rating BETWEEN 1 AND 5),
    CONSTRAINT uq_ratings_brand_platform_order UNIQUE (brand_id, platform_id, order_id),
    CONSTRAINT fk_ratings_brand FOREIGN KEY (brand_id) REFERENCES dbo.brands(id) ON DELETE CASCADE,
    CONSTRAINT fk_ratings_platform FOREIGN KEY (platform_id) REFERENCES dbo.platforms(id), -- RESTRICT (default NO ACTION)
    CONSTRAINT fk_ratings_agent FOREIGN KEY (assigned_agent_id) REFERENCES dbo.users(id) ON DELETE SET NULL,
    CONSTRAINT fk_ratings_uploaded_by FOREIGN KEY (uploaded_by) REFERENCES dbo.users(id),
    CONSTRAINT fk_ratings_recorded_by FOREIGN KEY (recorded_by) REFERENCES dbo.users(id)
  );
END
GO

IF OBJECT_ID('dbo.rating_call_attempts', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.rating_call_attempts (
    id               NVARCHAR(100)      NOT NULL PRIMARY KEY,
    rating_id        NVARCHAR(100)      NOT NULL,
    agent_id         NVARCHAR(100)      NULL,
    agent_name       NVARCHAR(MAX)      NULL,
    attempt_number   SMALLINT           NULL,
    outcome          NVARCHAR(50)       NOT NULL,
    note             NVARCHAR(MAX)      NULL,
    created_at       DATETIMEOFFSET(3)  NOT NULL DEFAULT (SYSDATETIMEOFFSET()),
    CONSTRAINT fk_rca_rating FOREIGN KEY (rating_id) REFERENCES dbo.ratings(id) ON DELETE CASCADE,
    CONSTRAINT fk_rca_agent FOREIGN KEY (agent_id) REFERENCES dbo.users(id)
  );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_ratings_brand' AND object_id = OBJECT_ID('dbo.ratings'))
  CREATE INDEX idx_ratings_brand ON dbo.ratings(brand_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_ratings_action' AND object_id = OBJECT_ID('dbo.ratings'))
  CREATE INDEX idx_ratings_action ON dbo.ratings(requires_action, action_status);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_ratings_agent' AND object_id = OBJECT_ID('dbo.ratings'))
  CREATE INDEX idx_ratings_agent ON dbo.ratings(assigned_agent_id);
GO

-- ==================================================================
-- Surveys module (Campaigns + live Queue + Survey Data records)
-- ==================================================================

IF OBJECT_ID('dbo.survey_templates', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.survey_templates (
    id          NVARCHAR(100)      NOT NULL PRIMARY KEY,
    name        NVARCHAR(300)      NOT NULL,
    brand_id    NVARCHAR(100)      NULL,
    created_by  NVARCHAR(100)      NULL,
    active      BIT                NOT NULL DEFAULT (1),
    created_at  DATETIMEOFFSET(3)  NOT NULL DEFAULT (SYSDATETIMEOFFSET()),
    CONSTRAINT fk_st_brand FOREIGN KEY (brand_id) REFERENCES dbo.brands(id) ON DELETE SET NULL,
    CONSTRAINT fk_st_created_by FOREIGN KEY (created_by) REFERENCES dbo.users(id)
  );
END
GO

IF OBJECT_ID('dbo.survey_questions', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.survey_questions (
    id            NVARCHAR(100) NOT NULL PRIMARY KEY,
    template_id   NVARCHAR(100) NOT NULL,
    [text]        NVARCHAR(MAX) NOT NULL,
    answer_type   NVARCHAR(50)  NOT NULL DEFAULT ('free_text'),
    [options]     NVARCHAR(MAX) NULL, -- JSON array, validate with ISJSON()
    q_order       INT           NOT NULL DEFAULT (0),
    segment       NVARCHAR(100) NULL,
    CONSTRAINT fk_sq_template FOREIGN KEY (template_id) REFERENCES dbo.survey_templates(id) ON DELETE CASCADE
  );
END
GO

IF OBJECT_ID('dbo.survey_campaigns', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.survey_campaigns (
    id                NVARCHAR(100)      NOT NULL PRIMARY KEY,
    brand_id          NVARCHAR(100)      NULL,
    requested_by      NVARCHAR(100)      NULL,
    requester_role    NVARCHAR(50)       NULL,
    template_id       NVARCHAR(100)      NULL,
    survey_type       NVARCHAR(50)       NOT NULL DEFAULT ('daily_normal'),
    assignment_mode   NVARCHAR(50)       NOT NULL DEFAULT ('open'),
    continuity_type   NVARCHAR(50)       NOT NULL DEFAULT ('one_time_slot'),
    requested_count   INT                NOT NULL DEFAULT (0),
    duration_days     INT                NOT NULL DEFAULT (1),
    status            NVARCHAR(50)       NOT NULL DEFAULT ('pending'),
    default_agent_id  NVARCHAR(100)      NULL,
    created_at        DATETIMEOFFSET(3)  NOT NULL DEFAULT (SYSDATETIMEOFFSET()),
    CONSTRAINT fk_sc_brand FOREIGN KEY (brand_id) REFERENCES dbo.brands(id) ON DELETE SET NULL,
    CONSTRAINT fk_sc_requested_by FOREIGN KEY (requested_by) REFERENCES dbo.users(id),
    CONSTRAINT fk_sc_template FOREIGN KEY (template_id) REFERENCES dbo.survey_templates(id) ON DELETE SET NULL,
    CONSTRAINT fk_sc_default_agent FOREIGN KEY (default_agent_id) REFERENCES dbo.users(id) ON DELETE SET NULL
  );
END
GO

IF OBJECT_ID('dbo.survey_assignments', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.survey_assignments (
    id                 NVARCHAR(100)      NOT NULL PRIMARY KEY,
    campaign_id        NVARCHAR(100)      NOT NULL,
    brand_id           NVARCHAR(100)      NULL,
    customer_phone     NVARCHAR(100)      NOT NULL,
    assigned_agent_id  NVARCHAR(100)      NULL,
    attempt_count      INT                NOT NULL DEFAULT (0),
    status             NVARCHAR(50)       NOT NULL DEFAULT ('pending'),
    scheduled_date     DATE               NOT NULL,
    created_at         DATETIMEOFFSET(3)  NOT NULL DEFAULT (SYSDATETIMEOFFSET()),
    reachability       NVARCHAR(50)       NULL,
    action_type        NVARCHAR(50)       NOT NULL DEFAULT ('no_action'),
    completed_at       DATETIMEOFFSET(3)  NULL,
    segment            NVARCHAR(100)      NULL,
    CONSTRAINT fk_sa_campaign FOREIGN KEY (campaign_id) REFERENCES dbo.survey_campaigns(id) ON DELETE CASCADE,
    CONSTRAINT fk_sa_brand FOREIGN KEY (brand_id) REFERENCES dbo.brands(id) ON DELETE SET NULL,
    CONSTRAINT fk_sa_agent FOREIGN KEY (assigned_agent_id) REFERENCES dbo.users(id) ON DELETE SET NULL
  );
END
GO

IF OBJECT_ID('dbo.survey_call_attempts', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.survey_call_attempts (
    id              NVARCHAR(100)      NOT NULL PRIMARY KEY,
    assignment_id   NVARCHAR(100)      NOT NULL,
    agent_id        NVARCHAR(100)      NULL,
    attempt_number  INT                NULL,
    outcome         NVARCHAR(50)       NOT NULL,
    note            NVARCHAR(MAX)      NULL,
    created_at      DATETIMEOFFSET(3)  NOT NULL DEFAULT (SYSDATETIMEOFFSET()),
    CONSTRAINT fk_sca_assignment FOREIGN KEY (assignment_id) REFERENCES dbo.survey_assignments(id) ON DELETE CASCADE,
    CONSTRAINT fk_sca_agent FOREIGN KEY (agent_id) REFERENCES dbo.users(id)
  );
END
GO

IF OBJECT_ID('dbo.survey_responses', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.survey_responses (
    id              NVARCHAR(100)      NOT NULL PRIMARY KEY,
    assignment_id   NVARCHAR(100)      NOT NULL,
    agent_id        NVARCHAR(100)      NULL,
    answered_at     DATETIMEOFFSET(3)  NOT NULL DEFAULT (SYSDATETIMEOFFSET()),
    CONSTRAINT fk_sr_assignment FOREIGN KEY (assignment_id) REFERENCES dbo.survey_assignments(id) ON DELETE CASCADE,
    CONSTRAINT fk_sr_agent FOREIGN KEY (agent_id) REFERENCES dbo.users(id)
  );
END
GO

IF OBJECT_ID('dbo.survey_answers', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.survey_answers (
    id            NVARCHAR(100) NOT NULL PRIMARY KEY,
    response_id   NVARCHAR(100) NOT NULL,
    question_id   NVARCHAR(100) NULL,
    answer_value  NVARCHAR(MAX) NULL,
    answered      BIT           NOT NULL DEFAULT (0),
    CONSTRAINT fk_sans_response FOREIGN KEY (response_id) REFERENCES dbo.survey_responses(id) ON DELETE CASCADE,
    CONSTRAINT fk_sans_question FOREIGN KEY (question_id) REFERENCES dbo.survey_questions(id) ON DELETE SET NULL
  );
END
GO

IF OBJECT_ID('dbo.customer_contacts', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.customer_contacts (
    id                       NVARCHAR(100)      NOT NULL PRIMARY KEY,
    brand_id                 NVARCHAR(100)      NULL,
    phone_number             NVARCHAR(100)      NOT NULL,
    last_contacted_at        DATETIMEOFFSET(3)  NOT NULL DEFAULT (SYSDATETIMEOFFSET()),
    last_contacted_brand_id  NVARCHAR(100)      NULL,
    CONSTRAINT fk_cc_brand FOREIGN KEY (brand_id) REFERENCES dbo.brands(id) ON DELETE CASCADE
  );
END
GO

-- NOTE on UNIQUE(brand_id, phone_number): Postgres treats every NULL as
-- distinct, so rows with brand_id IS NULL never collide with each other.
-- SQL Server's UNIQUE constraint treats NULLs as equal, which would reject
-- a second NULL-brand row for the same phone. A filtered index (WHERE
-- brand_id IS NOT NULL) reproduces the Postgres behaviour exactly: it only
-- constrains rows that actually have a brand.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'uq_cc_brand_phone' AND object_id = OBJECT_ID('dbo.customer_contacts'))
  CREATE UNIQUE INDEX uq_cc_brand_phone ON dbo.customer_contacts(brand_id, phone_number)
    WHERE brand_id IS NOT NULL;
GO

IF OBJECT_ID('dbo.survey_records', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.survey_records (
    id                    NVARCHAR(100)      NOT NULL PRIMARY KEY,
    record_type           NVARCHAR(50)       NOT NULL,
    brand_id              NVARCHAR(100)      NULL,
    brand_label           NVARCHAR(200)      NULL,
    platform_id           NVARCHAR(100)      NULL,
    platform_label        NVARCHAR(200)      NULL,
    order_id              NVARCHAR(150)      NULL,
    phone                 NVARCHAR(100)      NULL,
    customer_name         NVARCHAR(MAX)      NULL,
    item_name             NVARCHAR(MAX)      NULL,
    rate                  SMALLINT           NULL,
    product_feedback      NVARCHAR(200)      NULL,
    served_by             NVARCHAR(200)      NULL,
    answered              BIT                NOT NULL DEFAULT (0),
    customer_suggestion   NVARCHAR(MAX)      NULL,
    comment                NVARCHAR(MAX)      NULL,
    complaint              NVARCHAR(MAX)      NULL,
    note                   NVARCHAR(MAX)      NULL,
    trials                 NVARCHAR(100)      NULL,
    extra                  NVARCHAR(MAX)      NULL, -- JSON object, validate with ISJSON()
    record_date            NVARCHAR(50)       NULL,
    uploaded_by            NVARCHAR(100)      NULL,
    created_at              DATETIMEOFFSET(3)  NOT NULL DEFAULT (SYSDATETIMEOFFSET()),
    segment                 NVARCHAR(100)      NULL,
    CONSTRAINT fk_srec_brand FOREIGN KEY (brand_id) REFERENCES dbo.brands(id) ON DELETE SET NULL,
    CONSTRAINT fk_srec_platform FOREIGN KEY (platform_id) REFERENCES dbo.platforms(id) ON DELETE SET NULL,
    CONSTRAINT fk_srec_uploaded_by FOREIGN KEY (uploaded_by) REFERENCES dbo.users(id)
  );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_sa_sched' AND object_id = OBJECT_ID('dbo.survey_assignments'))
  CREATE INDEX idx_sa_sched ON dbo.survey_assignments(scheduled_date, status);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_sa_campaign' AND object_id = OBJECT_ID('dbo.survey_assignments'))
  CREATE INDEX idx_sa_campaign ON dbo.survey_assignments(campaign_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_sa_agent' AND object_id = OBJECT_ID('dbo.survey_assignments'))
  CREATE INDEX idx_sa_agent ON dbo.survey_assignments(assigned_agent_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_srec_type' AND object_id = OBJECT_ID('dbo.survey_records'))
  CREATE INDEX idx_srec_type ON dbo.survey_records(record_type);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_cc_phone' AND object_id = OBJECT_ID('dbo.customer_contacts'))
  CREATE INDEX idx_cc_phone ON dbo.customer_contacts(phone_number);
GO

-- Filtered unique index: at most one active recurring-task instance per
-- (template, date). NULL template_id rows (ad-hoc tasks) are excluded, same
-- as the Postgres partial unique index.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'uq_assigned_tasks_template_date' AND object_id = OBJECT_ID('dbo.assigned_tasks'))
  CREATE UNIQUE INDEX uq_assigned_tasks_template_date ON dbo.assigned_tasks(template_id, task_date)
    WHERE template_id IS NOT NULL;
GO

PRINT 'Call_Reason schema created (23 tables).';
