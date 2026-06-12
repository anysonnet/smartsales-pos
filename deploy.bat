@echo off
chcp 65001 > null
echo ===================================================
echo     SmartSales POS - Cloudflare D1 Deploy Tool
echo ===================================================
echo.
echo ขั้นตอนที่ 1: เข้าสู่ระบบ Cloudflare...
call npx wrangler login
if %errorlevel% neq 0 (
    echo.
    echo [ข้อผิดพลาด] การเข้าสู่ระบบล้มเหลว กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ต
    pause
    exit /b %errorlevel%
)

echo.
echo ขั้นตอนที่ 2: สร้างฐานข้อมูล D1 บนบัญชี Cloudflare ของคุณ...
call npx wrangler d1 create smartsales-db
if %errorlevel% neq 0 (
    echo.
    echo [ข้อผิดพลาด] ไม่สามารถสร้างฐานข้อมูล D1 ได้
    pause
    exit /b %errorlevel%
)

echo.
echo [สำคัญ] กรุณาคัดลอกค่า "database_id" (รหัสยาวๆ ที่อยู่ในเครื่องหมายปีกกา) ที่แสดงขึ้นมาด้านบน
echo.
set /p DB_ID="วางรหัส database_id ของคุณที่นี่ แล้วกด Enter: "

if "%DB_ID%"=="" (
    echo รหัส Database ID ห้ามว่างเปล่า!
    pause
    exit /b 1
)

echo.
echo ขั้นตอนที่ 3: อัปเดตรหัสบาร์โค้ดและฐานข้อมูลในไฟล์ wrangler.toml ด้วยสคริปต์...
powershell -Command "(gc wrangler.toml) -replace 'REPLACE_WITH_YOUR_D1_DATABASE_ID', '%DB_ID%' | Out-File -encoding UTF8 wrangler.toml"

echo.
echo ขั้นตอนที่ 4: โหลดโครงสร้างฐานข้อมูลตาราง SQL (schema.sql) ขึ้น Cloudflare D1 ของจริง...
call npx wrangler d1 execute smartsales-db --remote --file=schema.sql
if %errorlevel% neq 0 (
    echo.
    echo [ข้อผิดพลาด] ไม่สามารถติดตั้งตารางข้อมูล SQL บน Cloudflare D1 ได้
    pause
    exit /b %errorlevel%
)

echo.
echo ขั้นตอนที่ 5: เริ่มทำการอัปโหลดเว็บแอปและ API ขึ้น Cloudflare Pages...
call npx wrangler pages deploy .
if %errorlevel% neq 0 (
    echo.
    echo [ข้อผิดพลาด] การอัปโหลดหน้าเว็บขึ้น Cloudflare Pages ล้มเหลว
    pause
    exit /b %errorlevel%
)

echo.
echo ===================================================
echo  การติดตั้งเสร็จสมบูรณ์เรียบร้อยแล้ว! เว็บของคุณพร้อมใช้งานแล้ว
echo ===================================================
pause
