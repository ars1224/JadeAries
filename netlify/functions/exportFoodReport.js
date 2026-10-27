// Use ExcelJS's self-contained build so Netlify does not need to reconstruct its
// optional archiver/glob dependency tree inside the function bundle.
const ExcelJS = require("exceljs/dist/exceljs.min.js");
const PDFDocument = require("pdfkit");
const { isAdminAuthorized } = require("./lib/adminAuth");
const { buildFoodReport } = require("./lib/foodReport");
const { json, methodNotAllowed } = require("./lib/http");
const {
  displayMenuName,
  normalizeDietaryCodes,
  privateMenuPrice,
} = require("./lib/menu");
const supabase = require("./lib/supabase");

const BRAND = {
  rose: "#c96582",
  sage: "#607c58",
  sageWash: "#eef3e9",
  cream: "#fbf8ef",
  line: "#e6d7c3",
  text: "#4b4844",
  muted: "#77716a",
};

function reportDate(date) {
  return new Intl.DateTimeFormat("en-NZ", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Pacific/Auckland",
  }).format(date);
}

function fileDate(date) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Pacific/Auckland",
  }).format(date);
}

function currency(value) {
  return new Intl.NumberFormat("en-NZ", {
    style: "currency",
    currency: "NZD",
  }).format(Number(value || 0));
}

async function createExcel(report) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Jhon Aries & Charmie Jade";
  workbook.created = report.generatedAt;
  workbook.modified = report.generatedAt;

  const sheet = workbook.addWorksheet("Table assignments", {
    properties: { defaultRowHeight: 22 },
    views: [{ state: "frozen", ySplit: 1, showGridLines: false }],
    pageSetup: {
      orientation: "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    },
  });

  sheet.columns = [
    { header: "Table #", key: "tableNumber", width: 13 },
    { header: "Name", key: "name", width: 34 },
    { header: "Main", key: "main", width: 48 },
    { header: "Dessert", key: "dessert", width: 38 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.height = 30;
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF607C58" } };
    cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = { bottom: { style: "medium", color: { argb: "FFFFFFFF" } } };
  });

  report.seatingRows.forEach((guest, index) => {
    const row = sheet.addRow({
      tableNumber: guest.tableNumber ?? "Unassigned",
      name: guest.name,
      main: guest.main,
      dessert: guest.dessert,
    });
    row.height = 28;
    row.eachCell((cell, columnNumber) => {
      cell.font = { name: "Arial", size: 10, color: { argb: "FF4B4844" } };
      cell.alignment = {
        horizontal: columnNumber === 1 ? "center" : "left",
        vertical: "middle",
        wrapText: true,
      };
      cell.border = { bottom: { style: "thin", color: { argb: "FFE6D7C3" } } };
      if (index % 2 === 1) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFBF8EF" } };
      }
    });
  });

  sheet.autoFilter = { from: "A1", to: `D${Math.max(sheet.rowCount, 1)}` };
  sheet.headerFooter.oddFooter = `Generated ${reportDate(report.generatedAt)}`;

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function pdfText(value) {
  return String(value || "")
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"');
}

function createPdf(report) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margins: { top: 38, right: 42, bottom: 48, left: 42 },
      bufferPages: true,
      info: {
        Title: "Food orders",
        Author: "Jhon Aries & Charmie Jade",
        Subject: "Private catering report",
      },
    });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    function addPageHeading(continued = false) {
      doc.font("Times-Bold").fontSize(continued ? 18 : 25).fillColor(BRAND.rose);
      doc.text(continued ? "Food orders (continued)" : "Food orders", { lineGap: 2 });
      doc.font("Helvetica").fontSize(8.5).fillColor(BRAND.muted);
      doc.text(
        `Jhon Aries & Charmie Jade | Private catering report | Generated ${reportDate(report.generatedAt)}`
      );
      doc.moveDown(1.1);
    }

    function ensureSpace(height) {
      if (doc.y + height <= doc.page.height - doc.page.margins.bottom - 16) {
        return;
      }
      doc.addPage();
      addPageHeading(true);
    }

    addPageHeading(false);
    const summaryY = doc.y;
    const boxGap = 12;
    const boxWidth = (contentWidth - boxGap * 2) / 3;
    [
      ["Main orders", report.mainCount],
      ["Dessert orders", report.dessertCount],
      ["Combined total (NZD)", currency(report.grandTotal)],
    ].forEach(([label, value], index) => {
      const x = doc.page.margins.left + index * (boxWidth + boxGap);
      doc.roundedRect(x, summaryY, boxWidth, 54, 7).fillAndStroke(BRAND.sageWash, "#cbd4c3");
      doc.font("Helvetica-Bold").fontSize(7).fillColor(BRAND.sage).text(
        label.toUpperCase(),
        x + 12,
        summaryY + 10,
        { width: boxWidth - 24 }
      );
      doc.font("Times-Bold").fontSize(19).fillColor(BRAND.rose).text(
        String(value),
        x + 12,
        summaryY + 25,
        { width: boxWidth - 24 }
      );
    });
    doc.y = summaryY + 72;

    report.sections.forEach((section) => {
      ensureSpace(44);
      const sectionY = doc.y;
      doc.font("Times-Bold").fontSize(18).fillColor(BRAND.rose).text(section.title);
      doc.font("Helvetica-Bold").fontSize(8).fillColor(BRAND.sage).text(
        `${section.quantity} orders | ${currency(section.total)}`,
        doc.page.margins.left,
        sectionY + 5,
        { width: contentWidth, align: "right" }
      );
      doc.moveTo(doc.page.margins.left, doc.y + 3)
        .lineTo(doc.page.width - doc.page.margins.right, doc.y + 3)
        .strokeColor(BRAND.line)
        .stroke();
      doc.moveDown(1.1);

      section.items.forEach((item) => {
        const guestText = item.orders.length
          ? item.orders.map((order) => order.name).join(", ")
          : "No orders yet";
        const notesText = item.orders
          .filter((order) => order.dietaryRequirements)
          .map((order) => `${order.name}: ${order.dietaryRequirements}`)
          .join("; ") || "None recorded";
        const detail = `${pdfText(item.description)} | Dietary codes: ${item.dietaryCodes.join(", ") || "-"}`;
        const cardHeight = 62
          + doc.heightOfString(pdfText(guestText), { width: contentWidth - 22 })
          + doc.heightOfString(pdfText(notesText), { width: contentWidth - 22 });
        ensureSpace(cardHeight);
        const cardY = doc.y;
        doc.roundedRect(doc.page.margins.left, cardY, contentWidth, cardHeight - 7, 6)
          .fillAndStroke(BRAND.cream, BRAND.line);
        doc.font("Times-Bold").fontSize(12).fillColor(BRAND.text).text(
          pdfText(item.name),
          doc.page.margins.left + 11,
          cardY + 9,
          { width: contentWidth - 255 }
        );
        doc.font("Helvetica-Bold").fontSize(8.5).fillColor(BRAND.sage).text(
          `${currency(item.unitPrice)} each | ${item.quantity} order${item.quantity === 1 ? "" : "s"} | ${currency(item.subtotal)}`,
          doc.page.width - doc.page.margins.right - 230,
          cardY + 11,
          { width: 219, align: "right" }
        );
        doc.font("Helvetica").fontSize(7.7).fillColor(BRAND.muted).text(
          detail,
          doc.page.margins.left + 11,
          cardY + 27,
          { width: contentWidth - 22 }
        );
        doc.font("Helvetica-Bold").fontSize(7.5).fillColor(BRAND.sage).text(
          "ORDERED BY",
          doc.page.margins.left + 11,
          doc.y + 7,
          { continued: true }
        );
        doc.font("Helvetica").fillColor(BRAND.text).text(`  ${pdfText(guestText)}`);
        doc.font("Helvetica-Bold").fillColor(BRAND.sage).text(
          "GUEST DIETARY REQUIREMENTS",
          doc.page.margins.left + 11,
          doc.y + 4,
          { continued: true }
        );
        doc.font("Helvetica").fillColor(BRAND.text).text(`  ${pdfText(notesText)}`);
        doc.y = cardY + cardHeight;
      });
      doc.moveDown(0.35);
    });

    const pageRange = doc.bufferedPageRange();
    for (let pageIndex = pageRange.start; pageIndex < pageRange.start + pageRange.count; pageIndex += 1) {
      doc.switchToPage(pageIndex);
      doc.font("Helvetica").fontSize(7).fillColor(BRAND.muted).text(
        `Private admin report | Page ${pageIndex - pageRange.start + 1} of ${pageRange.count}`,
        doc.page.margins.left,
        doc.page.height - doc.page.margins.bottom - 10,
        { width: contentWidth, align: "center", lineBreak: false }
      );
    }

    doc.end();
  });
}

function one(value) {
  return Array.isArray(value) ? (value[0] || null) : (value || null);
}

function buildSupabaseFoodReport(guestRows, optionRows) {
  const menu = (Array.isArray(optionRows) ? optionRows : []).map((row) => ({
    slug: String(row.id),
    category: row.course,
    name: displayMenuName(row.name),
    description: row.description || "",
    dietaryCodes: normalizeDietaryCodes(row.dietary_restrictions),
    price: privateMenuPrice(row.name),
  }));
  const guests = (Array.isArray(guestRows) ? guestRows : []).map((row) => {
    const choice = one(row.guest_food_choices);
    return {
      name: row.full_name,
      status: row.rsvp_status,
      mealChoice: choice?.main_id ? String(choice.main_id) : null,
      dessertChoice: choice?.dessert_id ? String(choice.dessert_id) : null,
      dietaryRequirements: row.dietary_requirements || "",
      tableNumber: row.table_number === null || row.table_number === undefined
        ? null
        : Number(row.table_number),
    };
  });

  const menuNames = new Map(menu.map((item) => [item.slug, item.name]));
  const report = buildFoodReport(guests, menu);
  report.seatingRows = guests
    .filter((guest) => guest.status === "attending")
    .map((guest) => ({
      tableNumber: Number.isInteger(guest.tableNumber) ? guest.tableNumber : null,
      name: guest.name || "Unnamed guest",
      main: menuNames.get(guest.mealChoice) || "Not selected",
      dessert: menuNames.get(guest.dessertChoice) || "Not selected",
    }))
    .sort((left, right) => {
      if (left.tableNumber === null && right.tableNumber !== null) return 1;
      if (left.tableNumber !== null && right.tableNumber === null) return -1;
      if (left.tableNumber !== right.tableNumber) {
        return (left.tableNumber || 0) - (right.tableNumber || 0);
      }
      return left.name.localeCompare(right.name);
    });
  return report;
}

async function loadAttendingGuests() {
  const selectWithTable = "full_name,rsvp_status,dietary_requirements,table_number,guest_food_choices(main_id,dessert_id)";
  const selectWithoutTable = "full_name,rsvp_status,dietary_requirements,guest_food_choices(main_id,dessert_id)";
  const suffix = "&rsvp_status=eq.attending&order=full_name.asc&limit=1000";
  try {
    return await supabase.request(
      `guests?select=${encodeURIComponent(selectWithTable)}${suffix}`
    );
  } catch (error) {
    if (error?.code !== "PGRST204" && error?.code !== "42703") throw error;
    return supabase.request(
      `guests?select=${encodeURIComponent(selectWithoutTable)}${suffix}`
    );
  }
}

exports.handler = async (event) => {
  if (!isAdminAuthorized(event)) {
    return json(401, { error: "Your admin session has expired. Please log in again." });
  }

  if (event.httpMethod !== "GET") {
    return methodNotAllowed("GET");
  }

  const format = String(event.queryStringParameters?.format || "").toLowerCase();
  if (!new Set(["pdf", "xlsx"]).has(format)) {
    return json(400, { error: "Choose either pdf or xlsx format." });
  }

  try {
    const optionSelect = "id,course,name,description,dietary_restrictions,sort_order";
    const [guestRows, optionRows] = await Promise.all([
      loadAttendingGuests(),
      supabase.request(
        `food_options?select=${encodeURIComponent(optionSelect)}&is_active=eq.true&course=in.(main,dessert)&order=sort_order.asc`
      ),
    ]);
    const report = buildSupabaseFoodReport(guestRows, optionRows);
    const output = format === "pdf" ? await createPdf(report) : await createExcel(report);
    const filename = format === "pdf"
      ? `food-orders-${fileDate(report.generatedAt)}.pdf`
      : `table-assignments-${fileDate(report.generatedAt)}.xlsx`;

    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Type": format === "pdf"
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
      body: output.toString("base64"),
    };
  } catch (error) {
    console.error("Food report export failed", {
      status: error?.status,
      code: error?.code,
      name: error?.name,
    });
    return json(500, { error: "The food report could not be generated right now." });
  }
};

module.exports.createExcel = createExcel;
module.exports.createPdf = createPdf;
module.exports.buildSupabaseFoodReport = buildSupabaseFoodReport;
