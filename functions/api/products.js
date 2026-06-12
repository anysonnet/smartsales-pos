// Cloudflare Pages API Endpoint: /api/products

const DEFAULT_PRODUCTS = [
  { id: "P001", name: "โค้ก ออริจินัล 325มล (Coke 325ml)", barcode: "8850999111101", category: "Beverages", price: 15, cost: 10, stock: 120 },
  { id: "P002", name: "น้ำดื่ม สิงห์ 600มล (Singha Water 600ml)", barcode: "8850999111118", category: "Beverages", price: 10, cost: 6, stock: 85 },
  { id: "P003", name: "นมสด เมจิ รสจืด 450มล (Meiji Milk 450ml)", barcode: "8850999111125", category: "Beverages", price: 28, cost: 20, stock: 8 },
  { id: "P004", name: "โออิชิ กรีนที รสต้นตำรับ 380มล (Oishi Green Tea)", barcode: "8850999111132", category: "Beverages", price: 20, cost: 13, stock: 50 },
  { id: "P005", name: "เลย์ มันฝรั่งแท้ รสคลาสสิก 50ก (Lays Classic 50g)", barcode: "8850999111149", category: "Snacks", price: 30, cost: 21, stock: 45 },
  { id: "P006", name: "เถ้าแก่น้อย สาหร่ายทอด รสเผ็ด (Taokaenoi Seaweed)", barcode: "8850999111156", category: "Snacks", price: 39, cost: 27, stock: 3 },
  { id: "P007", name: "บะหมี่ มาม่า ต้มยำกุ้งน้ำข้น (Mama Cup Tomyum)", barcode: "8850999111163", category: "Snacks", price: 18, cost: 12, stock: 140 },
  { id: "P008", name: "สายชาร์จ Type-C 1.2เมตร (Type-C Cable 1.2m)", barcode: "8850999111170", category: "Electronics", price: 199, cost: 80, stock: 25 },
  { id: "P009", name: "พาวเวอร์แบงค์ 10000mAh (Powerbank 10000mAh)", barcode: "8850999111187", category: "Electronics", price: 590, cost: 320, stock: 15 },
  { id: "P010", name: "หูฟังบลูทูธไร้สาย (TWS Wireless Earbuds)", barcode: "8850999111194", category: "Electronics", price: 890, cost: 450, stock: 0 },
  { id: "P011", name: "ปากกาลูกลื่น 0.5มม (Ballpoint Pen Blue 0.5mm)", barcode: "8850999111200", category: "Stationery", price: 12, cost: 5, stock: 200 },
  { id: "P012", name: "กระดาษ Double A A4 80แกรม (Double A A4 500 Sheets)", barcode: "8850999111217", category: "Stationery", price: 145, cost: 110, stock: 30 },
  { id: "P013", name: "ร่มพับกันแดดกันฝน (Portable Folding Umbrella)", barcode: "8850999111224", category: "Household", price: 250, cost: 120, stock: 18 }
];

// GET: Fetch all products (Auto-seed if database is empty)
export async function onRequestGet(context) {
  try {
    const db = context.env.DB;
    if (!db) {
      return new Response(JSON.stringify({ error: "Database DB binding is missing. Check wrangler.toml." }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Check if products table is empty
    const checkEmpty = await db.prepare("SELECT COUNT(*) as count FROM products").first();
    
    if (checkEmpty && checkEmpty.count === 0) {
      // Auto-seed
      const statements = DEFAULT_PRODUCTS.map(p => 
        db.prepare("INSERT INTO products (id, name, barcode, category, price, cost, stock) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .bind(p.id, p.name, p.barcode, p.category, p.price, p.cost, p.stock)
      );
      await db.batch(statements);
    }

    // Select all products
    const { results } = await db.prepare("SELECT * FROM products").all();
    return new Response(JSON.stringify(results), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

// POST: Add or Edit a product (Upsert)
export async function onRequestPost(context) {
  try {
    const db = context.env.DB;
    const body = await context.request.json();
    
    const { id, name, barcode, category, price, cost, stock } = body;
    
    if (!id || !name || !barcode || !category || price === undefined || cost === undefined || stock === undefined) {
      return new Response(JSON.stringify({ error: "Missing required fields." }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Upsert query
    await db.prepare(`
      INSERT INTO products (id, name, barcode, category, price, cost, stock)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        barcode = excluded.barcode,
        category = excluded.category,
        price = excluded.price,
        cost = excluded.cost,
        stock = excluded.stock
    `).bind(id, name, barcode, category, price, cost, stock).run();

    return new Response(JSON.stringify({ success: true, product: body }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

// DELETE: Remove a product by ID
export async function onRequestDelete(context) {
  try {
    const db = context.env.DB;
    const url = new URL(context.request.url);
    const id = url.searchParams.get("id");
    
    if (!id) {
      return new Response(JSON.stringify({ error: "Product SKU ID is required." }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    await db.prepare("DELETE FROM products WHERE id = ?").bind(id).run();
    
    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
