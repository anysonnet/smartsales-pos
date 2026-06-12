// Cloudflare Pages API Endpoint: /api/transactions

// GET: Fetch all transactions (Auto-seed 7-day history if empty)
export async function onRequestGet(context) {
  try {
    const db = context.env.DB;
    if (!db) {
      return new Response(JSON.stringify({ error: "Database DB binding is missing. Check wrangler.toml." }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Check if transactions table is empty
    const checkEmpty = await db.prepare("SELECT COUNT(*) as count FROM transactions").first();
    
    if (checkEmpty && checkEmpty.count === 0) {
      // Fetch products to verify we can seed
      const { results: prods } = await db.prepare("SELECT * FROM products").all();
      if (prods && prods.length > 0) {
        // Generate and seed mock transactions
        const seedTxs = generateMockTransactions(prods);
        
        const statements = seedTxs.map(t => 
          db.prepare(`
            INSERT INTO transactions (id, timestamp, items, subtotal, discount, tax, total, totalCost, profit, paymentMethod, cashReceived, change)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(t.id, t.timestamp, JSON.stringify(t.items), t.subtotal, t.discount, t.tax, t.total, t.totalCost, t.profit, t.paymentMethod, t.cashReceived, t.change)
        );
        
        await db.batch(statements);
      }
    }

    const { results } = await db.prepare("SELECT * FROM transactions").all();
    
    // Parse the JSON items strings before sending to client
    const parsedResults = results.map(r => ({
      ...r,
      items: JSON.parse(r.items)
    }));

    return new Response(JSON.stringify(parsedResults), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

// POST: Add new transaction and decrement stocks atomically
export async function onRequestPost(context) {
  try {
    const db = context.env.DB;
    const body = await context.request.json();
    
    const { 
      id, timestamp, items, subtotal, discount, 
      tax, total, totalCost, profit, paymentMethod, 
      cashReceived, change 
    } = body;
    
    if (!id || !timestamp || !items || subtotal === undefined || total === undefined || totalCost === undefined) {
      return new Response(JSON.stringify({ error: "Missing required fields." }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Build batch statements
    const statements = [];
    
    // 1. Insert Transaction statement
    statements.push(
      db.prepare(`
        INSERT INTO transactions (id, timestamp, items, subtotal, discount, tax, total, totalCost, profit, paymentMethod, cashReceived, change)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(id, timestamp, JSON.stringify(items), subtotal, discount, tax, total, totalCost, profit, paymentMethod, cashReceived, change)
    );

    // 2. Decrement Stocks statement for each item
    items.forEach(item => {
      statements.push(
        db.prepare("UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ?")
          .bind(item.quantity, item.productId)
      );
    });

    // Run batch transaction execution
    await db.batch(statements);

    return new Response(JSON.stringify({ success: true, transactionId: id }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

// Helper to generate mock transactions for seeding
function generateMockTransactions(products) {
  const transactions = [];
  const paymentMethods = ["Cash", "Credit Card", "QR Code"];
  const now = new Date();
  let transIdCounter = 10001;

  for (let d = 6; d >= 0; d--) {
    const currentDate = new Date(now);
    currentDate.setDate(now.getDate() - d);
    
    const numTransactions = Math.floor(Math.random() * 5) + 3; // 3 to 7 transactions per day
    
    for (let t = 0; t < numTransactions; t++) {
      const transactionTime = new Date(currentDate);
      transactionTime.setHours(Math.floor(Math.random() * 12) + 9); // 9am - 9pm
      transactionTime.setMinutes(Math.floor(Math.random() * 60));
      transactionTime.setSeconds(Math.floor(Math.random() * 60));

      const itemsCount = Math.floor(Math.random() * 3) + 1; // 1 to 3 items
      const items = [];
      let subtotal = 0;
      let totalCost = 0;

      const shuffledProducts = [...products].sort(() => 0.5 - Math.random());
      
      for (let i = 0; i < itemsCount; i++) {
        const prod = shuffledProducts[i];
        const qty = Math.floor(Math.random() * 2) + 1; // 1 to 2 qty
        
        items.push({
          productId: prod.id,
          name: prod.name,
          barcode: prod.barcode,
          category: prod.category,
          price: prod.price,
          cost: prod.cost,
          quantity: qty,
          totalPrice: prod.price * qty,
          totalCost: prod.cost * qty
        });

        subtotal += prod.price * qty;
        totalCost += prod.cost * qty;
      }

      const discount = Math.random() < 0.2 ? 10 : 0;
      const finalDiscount = Math.min(discount, subtotal);
      const total = subtotal - finalDiscount;
      const tax = Math.round((total * 7 / 107) * 100) / 100;
      const profit = total - totalCost;
      const paymentMethod = paymentMethods[Math.floor(Math.random() * paymentMethods.length)];
      
      let cashReceived = 0;
      let change = 0;
      if (paymentMethod === "Cash") {
        cashReceived = Math.ceil(total / 100) * 100;
        change = cashReceived - total;
      }

      transactions.push({
        id: `TX${transIdCounter++}`,
        timestamp: transactionTime.toISOString(),
        items: items,
        subtotal: subtotal,
        discount: finalDiscount,
        tax: tax,
        total: total,
        totalCost: totalCost,
        profit: profit,
        paymentMethod: paymentMethod,
        cashReceived: cashReceived,
        change: change
      });
    }
  }

  return transactions;
}
