import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';
export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(), label: text('label').notNull(), createdAt: integer('created_at').notNull(),
});
export const emailCredentials = sqliteTable('email_credentials', {
  userId: text('user_id').primaryKey().references(() => accounts.id),
  email: text('email').notNull().unique(), passwordHash: text('password_hash').notNull(),
  createdAt: integer('created_at').notNull(),
});
export const sessions = sqliteTable('sessions', {
  tokenHash: text('token_hash').primaryKey(), userId: text('user_id').notNull().references(() => accounts.id), expiresAt: integer('expires_at').notNull(),
}, table => [index('sessions_expiry_idx').on(table.expiresAt)]);
export const phoneChallenges = sqliteTable('phone_challenges', {
  phoneKey: text('phone_key').primaryKey(), codeHash: text('code_hash').notNull(), expiresAt: integer('expires_at').notNull(), sentAt: integer('sent_at').notNull(), attempts: integer('attempts').notNull().default(0), ready: integer('ready').notNull().default(0),
});
export const authLimits = sqliteTable('auth_limits', {
  bucket: text('bucket').primaryKey(), hits: integer('hits').notNull(), expiresAt: integer('expires_at').notNull(),
}, table => [index('auth_limits_expiry_idx').on(table.expiresAt)]);
export const tasks = sqliteTable('tasks', {
  userId: text('user_id').notNull().references(() => accounts.id), id: text('id').notNull(), date: text('date').notNull(), title: text('title').notNull(), category: text('category').notNull(), minutes: integer('minutes').notNull(), note: text('note').notNull(), updatedAt: integer('updated_at').notNull(),
}, table => [primaryKey({ columns: [table.userId, table.id] }), index('tasks_user_date_idx').on(table.userId, table.date)]);
export const reflections = sqliteTable('reflections', {
  userId: text('user_id').notNull().references(() => accounts.id), date: text('date').notNull(), note: text('note').notNull(), updatedAt: integer('updated_at').notNull(),
}, table => [primaryKey({ columns: [table.userId, table.date] })]);
