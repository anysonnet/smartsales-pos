// Mock Data for Daily Sales Report System
window.DEFAULT_MOCK_DATA = {
  products: [
    // Beverages
    { id: "P001", name: "โค้ก ออริจินัล 325มล (Coke 325ml)", barcode: "8850999111101", category: "Beverages", price: 15, cost: 10, stock: 120 },
    { id: "P002", name: "น้ำดื่ม สิงห์ 600มล (Singha Water 600ml)", barcode: "8850999111118", category: "Beverages", price: 10, cost: 6, stock: 85 },
    { id: "P003", name: "นมสด เมจิ รสจืด 450มล (Meiji Milk 450ml)", barcode: "8850999111125", category: "Beverages", price: 28, cost: 20, stock: 8 }, // Low stock
    { id: "P004", name: "โออิชิ กรีนที รสต้นตำรับ 380มล (Oishi Green Tea)", barcode: "8850999111132", category: "Beverages", price: 20, cost: 13, stock: 50 },

    // Snacks & Food
    { id: "P005", name: "เลย์ มันฝรั่งแท้ รสคลาสสิก 50ก (Lays Classic 50g)", barcode: "8850999111149", category: "Snacks", price: 30, cost: 21, stock: 45 },
    { id: "P006", name: "เถ้าแก่น้อย สาหร่ายทอด รสเผ็ด (Taokaenoi Seaweed)", barcode: "8850999111156", category: "Snacks", price: 39, cost: 27, stock: 3 }, // Low stock
    { id: "P007", name: "บะหมี่ มาม่า ต้มยำกุ้งน้ำข้น (Mama Cup Tomyum)", barcode: "8850999111163", category: "Snacks", price: 18, cost: 12, stock: 140 },

    // Electronics & Accessories
    { id: "P008", name: "สายชาร์จ Type-C 1.2เมตร (Type-C Cable 1.2m)", barcode: "8850999111170", category: "Electronics", price: 199, cost: 80, stock: 25 },
    { id: "P009", name: "พาวเวอร์แบงค์ 10000mAh (Powerbank 10000mAh)", barcode: "8850999111187", category: "Electronics", price: 590, cost: 320, stock: 15 },
    { id: "P010", name: "หูฟังบลูทูธไร้สาย (TWS Wireless Earbuds)", barcode: "8850999111194", category: "Electronics", price: 890, cost: 450, stock: 0 }, // Out of stock

    // Household & Stationery
    { id: "P011", name: "ปากกาลูกลื่น 0.5มม (Ballpoint Pen Blue 0.5mm)", barcode: "8850999111200", category: "Stationery", price: 12, cost: 5, stock: 200 },
    { id: "P012", name: "กระดาษ Double A A4 80แกรม (Double A A4 500 Sheets)", barcode: "8850999111217", category: "Stationery", price: 145, cost: 110, stock: 30 },
    { id: "P013", name: "ร่มพับกันแดดกันฝน (Portable Folding Umbrella)", barcode: "8850999111224", category: "Household", price: 250, cost: 120, stock: 18 }
  ],
  transactions: []
};

// Helper function to generate mock transactions over the last 7 days
(function generateTransactions() {
  const products = window.DEFAULT_MOCK_DATA.products;
  const transactions = [];
  const paymentMethods = ["Cash", "Credit Card", "QR Code"];
  
  // Create transactions for the past 7 days (including today)
  const now = new Date();
  
  let transIdCounter = 10001;

  for (let d = 6; d >= 0; d--) {
    const currentDate = new Date(now);
    currentDate.setDate(now.getDate() - d);
    
    // Number of transactions per day: random between 4 and 10
    const numTransactions = Math.floor(Math.random() * 7) + 4;
    
    for (let t = 0; t < numTransactions; t++) {
      // Set random hour between 8:00 and 21:00
      const transactionTime = new Date(currentDate);
      transactionTime.setHours(Math.floor(Math.random() * 13) + 8);
      transactionTime.setMinutes(Math.floor(Math.random() * 60));
      transactionTime.setSeconds(Math.floor(Math.random() * 60));

      // Build cart
      const itemsCount = Math.floor(Math.random() * 4) + 1; // 1 to 4 unique items
      const items = [];
      let subtotal = 0;
      let totalCost = 0;

      // Shuffle products to pick random ones
      const shuffledProducts = [...products].sort(() => 0.5 - Math.random());
      
      for (let i = 0; i < itemsCount; i++) {
        const prod = shuffledProducts[i];
        const qty = Math.floor(Math.random() * 3) + 1; // Quantity 1 to 3
        
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

      // Add a potential discount (e.g. 5% chance or flat discount)
      const discount = Math.random() < 0.2 ? (Math.random() < 0.5 ? 20 : Math.round(subtotal * 0.1)) : 0;
      const finalDiscount = Math.min(discount, subtotal);
      const afterDiscount = subtotal - finalDiscount;
      
      // Calculate tax (7% VAT included in price usually, but let's show calculated VAT)
      const tax = Math.round((afterDiscount * 7 / 107) * 100) / 100;
      const total = afterDiscount;
      const profit = total - totalCost;

      const paymentMethod = paymentMethods[Math.floor(Math.random() * paymentMethods.length)];
      let cashReceived = 0;
      let change = 0;

      if (paymentMethod === "Cash") {
        // Round up to nearest 50, 100, 500, or 1000
        const denominations = [20, 50, 100, 500, 1000];
        for (let denom of denominations) {
          if (denom >= total) {
            cashReceived = denom;
            break;
          }
        }
        if (cashReceived === 0) {
          cashReceived = Math.ceil(total / 100) * 100;
        }
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

  window.DEFAULT_MOCK_DATA.transactions = transactions;
})();
