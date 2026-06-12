// Cloudflare Pages API Endpoint: /api/send-line-report
// Send daily EOD Sales Report to LINE Messaging API

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    
    // 1. Get LINE credentials from Environment or request body (fallback)
    const token = context.env.LINE_CHANNEL_ACCESS_TOKEN || body.lineToken;
    const toId = context.env.LINE_USER_ID || body.lineUserId;
    
    if (!token || !toId) {
      return new Response(JSON.stringify({ 
        error: "กรุณาตั้งค่า LINE Channel Access Token และ User/Group ID ในระบบก่อนส่งรายงาน" 
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const { 
      system_cash, 
      actual_cash, 
      diff, 
      qr_sales, 
      card_sales, 
      total_sales, 
      bill_count, 
      user, 
      timestamp 
    } = body;

    // Format date in Thai timezone/format
    const dateObj = new Date(timestamp);
    const dateStr = dateObj.toLocaleDateString('th-TH', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    const statusText = diff === 0 
      ? "✅ ตรงตามยอดขายระบบ" 
      : diff > 0 
        ? `⚠️ เงินเกิน +฿${diff.toFixed(2)}` 
        : `❌ เงินขาด -฿${Math.abs(diff).toFixed(2)}`;

    // Build the LINE Message
    const messageText = `📊 รายงานยอดขายประจำวัน (EOD)\n` +
      `📅 วันที่: ${dateStr}\n` +
      `👤 ผู้รายงาน: ${user}\n` +
      `----------------------------------\n` +
      `💵 ยอดขายเงินสดในระบบ: ฿${system_cash.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` +
      `💸 เงินสดคงเหลือจริง (นับได้): ฿${actual_cash.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` +
      `⚖️ ส่วนต่างเงินสด: ${statusText}\n` +
      `📱 ยอดโอนเงิน (QR/PromptPay): ฿${qr_sales.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` +
      `💳 ยอดบัตรเครดิต: ฿${card_sales.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` +
      `----------------------------------\n` +
      `💰 รวมยอดขายวันนี้: ฿${total_sales.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` +
      `🧾 จำนวนบิลทั้งหมด: ${bill_count} บิล\n` +
      `----------------------------------\n` +
      `SmartSales POS System`;

    // 2. Call LINE Messaging API
    const lineResponse = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({
        to: toId,
        messages: [
          {
            type: "text",
            text: messageText
          }
        ]
      })
    });

    if (!lineResponse.ok) {
      const errorData = await lineResponse.json();
      return new Response(JSON.stringify({ 
        error: `ส่งข้อความ LINE ล้มเหลว: ${errorData.message || lineResponse.statusText}` 
      }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

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
