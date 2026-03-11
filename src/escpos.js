function sanitizeText(value) {
  return String(value || "")
    .replace(/[^\x20-\x7E\u00C0-\u017F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function line(value = "") {
  return `${sanitizeText(value)}\n`;
}

function separator() {
  return "--------------------------------\n";
}

function buildOrderTicketBuffer(payload, options = {}) {
  const order = payload?.order || {};
  const items = Array.isArray(order.items) ? order.items : [];
  const customer = order.customer || {};
  const header = sanitizeText(options.ticketHeader || "Pizzeria");

  let text = "";
  text += line(header);
  text += line("TICKET COMMANDE");
  text += separator();
  text += line(`Commande: ${sanitizeText(order.number || `#${order.id || "?"}`)}`);
  text += line(`Retrait: ${sanitizeText(order.pickup_time || "-")}`);
  if (order.location?.name) {
    text += line(`Lieu: ${sanitizeText(order.location.name)}`);
  }
  text += separator();
  text += line(`Client: ${sanitizeText(customer.full_name || [customer.first_name, customer.last_name].filter(Boolean).join(" ") || "-")}`);
  if (customer.phone) {
    text += line(`Tel: ${sanitizeText(customer.phone)}`);
  }
  text += separator();

  for (const item of items) {
    const qty = Number(item?.qty || 0);
    const itemName = sanitizeText(item?.name || "Produit");
    text += line(`${qty}x ${itemName}`);

    const added = Array.isArray(item?.added_ingredients) ? item.added_ingredients : [];
    const removed = Array.isArray(item?.removed_ingredients) ? item.removed_ingredients : [];

    if (added.length > 0) {
      text += line(`  + ${added.map((entry) => sanitizeText(entry)).join(", ")}`);
    }
    if (removed.length > 0) {
      text += line(`  - ${removed.map((entry) => sanitizeText(entry)).join(", ")}`);
    }
  }

  text += separator();
  text += line(`Total: ${sanitizeText(order.total || "0.00")} ${sanitizeText(order.currency || "EUR")}`);
  if (order.note) {
    text += line(`Note: ${sanitizeText(order.note)}`);
  }
  text += separator();
  text += line(`Job: ${sanitizeText(payload?.job_id || "-")}`);
  text += "\n\n";

  const initialize = Buffer.from([0x1b, 0x40]);
  const content = Buffer.from(text, "utf8");
  const cut = Buffer.from([0x1d, 0x56, 0x41, 0x10]);
  return Buffer.concat([initialize, content, cut]);
}

function buildTestTicketBuffer(text, options = {}) {
  const header = sanitizeText(options.ticketHeader || "Pizzeria");
  const body = sanitizeText(text || "TEST IMPRESSION");
  const content = `${header}\nTEST\n${body}\n${new Date().toISOString()}\n\n`;
  return Buffer.concat([
    Buffer.from([0x1b, 0x40]),
    Buffer.from(content, "utf8"),
    Buffer.from([0x1d, 0x56, 0x41, 0x10]),
  ]);
}

module.exports = {
  buildOrderTicketBuffer,
  buildTestTicketBuffer,
};
