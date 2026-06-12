-- Database Schema for Daily Sales POS
-- Supported by Cloudflare D1 (SQLite)

-- Products Table
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  barcode TEXT UNIQUE NOT NULL,
  category TEXT NOT NULL,
  price REAL NOT NULL,
  cost REAL NOT NULL,
  stock INTEGER NOT NULL
);

-- Transactions Table
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  items TEXT NOT NULL, -- Stored as stringified JSON array
  subtotal REAL NOT NULL,
  discount REAL NOT NULL,
  tax REAL NOT NULL,
  total REAL NOT NULL,
  totalCost REAL NOT NULL,
  profit REAL NOT NULL,
  paymentMethod TEXT NOT NULL,
  cashReceived REAL NOT NULL,
  change REAL NOT NULL
);
