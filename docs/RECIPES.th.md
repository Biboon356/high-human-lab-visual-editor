# สูตรทำลุค (ภาษาไทย)

ทุกสูตรใช้ได้ในแอปเลย ไม่ต้องเขียนโค้ด เลือกคลิปบน timeline → แท็บ **Inspector** → **Effects chain → Presets…** แล้วปรับพารามิเตอร์ได้ตามชอบ
(`◇` = ใส่ keyframe, `∿` = ผูกกับเสียง/บีต)

## ✨ ทำคลิป TikTok ภาษาไทยด้วยปุ่มเดียว (TikTok Auto-Edit)
1. Import คลิปที่มีเสียงพูด แล้วคลิกเลือกบน timeline
2. กดปุ่ม **✨ TikTok Auto-Edit** บนแถบบน (หรือ `Ctrl/Cmd+Shift+A`)
3. ครั้งแรก: เลือกโมเดลเสียง (แนะนำ **Balanced**) แล้วกด Download (ครั้งเดียว ~540 MB) — ทำงานในเครื่อง ไม่อัปโหลดเสียง
   *ถ้าไม่อยากโหลดโมเดล:* กด "Use a subtitle file (.srt) instead…" แล้วเลือกไฟล์คำบรรยายของคุณ
4. เลือกตัวเลือก: ตัดช่วงเงียบ / ตัด เอ่อ-อืม / ซูมสลับ / เฟรม 9:16 / look / ปรับเสียงให้ดังพอดี −14 LUFS / สไตล์แคปชั่น
5. กด **✨ Run Auto-Edit** → ได้คลิปที่ตัดต่อ ใส่แคปชั่นไทยไฮไลต์ตามคำ จัดเฟรมแนวตั้งแล้ว (ยัง **แก้ต่อบน timeline ได้ทุกอย่าง** และ Undo ได้ในครั้งเดียว)
6. กด **Export for TikTok…** (ตั้ง 1080×1920 คุณภาพสูงให้แล้ว) หรือ **Export captions (.srt)**
- เปิดเส้นกรอบ **▣ Safe zone** ที่แถบเล่นวิดีโอ เพื่อดูว่าส่วนไหนของภาพจะโดนปุ่ม/ข้อความของแอป TikTok บัง
- ถ้าถอดเสียงผิด: ลองโมเดล Balanced/Best, หรือแก้ข้อความแคปชั่นได้ที่แท็บ Inspector ของคลิปข้อความนั้น

## 0. ตั้งค่าโปรเจกต์แนวตั้ง (TikTok / Reels)
- แท็บ **Project** → Canvas = `vertical-1080` (1080×1920) หรือ `vertical-720`
- ถ้านำเข้าวิดีโอแนวตั้งเป็นคลิปแรก แอปจะตั้งขนาดให้เองอัตโนมัติ
- ตอน Export เลือก Preset **"TikTok / Reels / Shorts"** ได้เลย

## 1. ภาพถ่ายเอกสารขาว-ดำ (Xerox) + เม็ด halftone
Preset: **Xerox Photocopy** (คอนทราสต์สูง + toner noise + เกรน) หรือ **Halftone Print (B&W)** (จุด halftone)
- ปรับ `Xerox Threshold → Level` ให้ภาพมืด/สว่างขึ้น, `Toner noise` = ความหยาบ
- เปลี่ยนสีหมึก/กระดาษได้ (`Ink`, `Paper`) เช่นหมึกเขียวเข้ม กระดาษครีม

## 2. โทนสีจัดแบบกราฟิก
- **Comic Flash (red/yellow)**: `Gradient Map` แดง→เหลือง + halftone สีอ่อน ๆ
- **Midnight Purple**: ม่วง/น้ำเงินเข้ม ขอบสีเหลื่อมเล็กน้อย
- ปรับสีเองที่ `Gradient Map → Shadows / Midtones / Highlights`

## 3. สติกเกอร์ขอบขาว (die-cut) และหน้าต่างวงกลม/ก้อน
- Preset **Die-Cut Sticker**: `Shape Mask` (รูปก้อนไม่เท่ากัน) + `Sticker Outline` ขอบขาวหนา
- Preset **Circle Window**: หน้าต่างวงกลมมีขอบ
- ปรับตำแหน่ง/ขนาดที่ `Shape Mask → Position X/Y, Size, Aspect, Rotate, Blob wobble`
- เทคนิค: วางคลิปซ้อนกันหลายแทร็ก แต่ละคลิปมีหน้าต่างคนละรูปทรง = ภาพ collage แบบคลิปอ้างอิงที่ 3
- ใส่ `Solarize / Channel Swap` เพื่อกลับสีนีออน และ `Slices / Cut Bars` เพื่อตัดภาพเป็นแถบดำ

## 4. ตัวอักษรกลวง + glitch
- แท็บซ้าย **02 Type** → preset **Hollow Glitch Block** (ตัวกลวง, เส้นขอบบาง, RGB split, แถบเลื่อน)
- `Fit width` ทำให้ตัวอักษรเต็มความกว้างเฟรมพอดี ไม่ล้นในแนวตั้ง
- โหมดผสม (Blend) = `exclusion` ทำให้ตัวอักษรกลับสีตามภาพข้างหลัง
- แอนิเมชัน `Stutter` ให้ตัวอักษรกระตุกเข้า, `Slam` ให้ทุบเข้ามา

## 5. เส้นขีดเขียนมือ + ฝุ่น/รอยขีดข่วน
- แท็บซ้าย **03 Organic** → **Scribble Contour (hand-drawn)**: เส้นไหวเหมือนวาดมือ (`Hand-drawn boil (fps)`)
- **Dust & Scratches (overlay)**: ฝุ่น/รอยขีดข่วนฟิล์ม วางทับด้วย blend `screen`
- **Root Growth (overlay)**: รากงอกจากด้านล่างทับวิดีโอ (ปรับ `Growth` ด้วย keyframe)

## 6. ตัดตามจังหวะเพลง
1. Import เพลงและวิดีโอ/ภาพ แล้วลากเพลงลงแทร็กเสียง
2. แท็บ **Audio-Reactive** → **Analyze project audio** (จะเห็นขีดบีตบนไม้บรรทัด timeline)
3. เลือกคลิป → ปุ่ม **♪ Cut on beats** (ตัดทุก N บีต) — Undo ได้
4. หรือกด **🎞 Auto-montage**: เรียงคลิป/ภาพที่ import ทั้งหมดลงแทร็กใหม่ ตัดตามบีต พร้อมสุ่ม look ต่อช็อต
5. ผูกพารามิเตอร์กับบีต: กด `∿` ข้างค่านั้น → เลือก `beat` เช่น preset **Beat Punch** (กล้องกระชากตามกลอง)

## 7. ความเร็วและเฟด
- Inspector → `Speed` (0.1–4×, เสียงไม่เพี้ยน) ใช้ทำสโลว์/เร่งความเร็ว
- `Fade in / Fade out` ทำภาพและเสียงจางเข้า-ออก

## คีย์ลัด
`Space` เล่น/หยุด · `S` ตัดที่ playhead · `Delete` ลบ · `←/→` ถอย/เดินหน้า 1 เฟรม · `+/-` ซูม timeline
`Ctrl/Cmd+Z` Undo · `Ctrl/Cmd+D` Duplicate · `Ctrl/Cmd+C/V` คัดลอก/วางคลิป · `Ctrl/Cmd+S` บันทึก · `Ctrl/Cmd+E` Export
