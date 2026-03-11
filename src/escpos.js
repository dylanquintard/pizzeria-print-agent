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
  return `${"-".repeat(42)}\n`;
}

function parseCustomerDisplay(customer) {
  const fullName = sanitizeText(customer?.full_name || "");
  const firstName = sanitizeText(customer?.first_name || "");
  const lastName = sanitizeText(customer?.last_name || "");

  if (firstName || lastName) {
    return {
      firstName: firstName || "-",
      lastName: lastName || "-",
    };
  }

  if (!fullName) {
    return {
      firstName: "-",
      lastName: "-",
    };
  }

  const parts = fullName.split(" ").filter(Boolean);
  if (parts.length === 1) {
    return {
      firstName: parts[0],
      lastName: "-",
    };
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

function formatPickupTime(value) {
  const raw = sanitizeText(value || "");
  if (!raw) return "-";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return raw;
  }
  const dd = String(parsed.getDate()).padStart(2, "0");
  const mm = String(parsed.getMonth() + 1).padStart(2, "0");
  const yyyy = parsed.getFullYear();
  const hh = String(parsed.getHours()).padStart(2, "0");
  const min = String(parsed.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

function buildOrderTicketBuffer(payload, options = {}) {
  const order = payload?.order || {};
  const items = Array.isArray(order.items) ? order.items : [];
  const customer = order.customer || {};
  const customerDisplay = parseCustomerDisplay(customer);
  const agentName = sanitizeText(options.agentName || "Print Agent");
  const isCopy = Boolean(payload?.reprint?.source_job_id);
  const ticketStatus = isCopy ? "COPIE" : "ORIGINAL";
  const orderNumber = sanitizeText(order.number || `A-${order.id || "?"}`);

  let text = "";
  text += line(ticketStatus);
  text += line(agentName);
  text += separator();
  text += line(`TICKET COMMANDE N: ${orderNumber}`);
  text += line(`Heure retrait: ${formatPickupTime(order.pickup_time)}`);
  text += separator();
  text += line("INFOS CLIENT");
  text += line(`Nom: ${customerDisplay.lastName}`);
  text += line(`Prenom: ${customerDisplay.firstName}`);
  text += line(`Numero: ${sanitizeText(customer.phone || "-")}`);
  text += separator();
  text += line("DETAILS COMMANDE");

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
  text += "\n\n";

  const initialize = Buffer.from([0x1b, 0x40]);
  const content = Buffer.from(text, "utf8");
  const cut = Buffer.from([0x1d, 0x56, 0x41, 0x10]);
  return Buffer.concat([initialize, content, cut]);
}

function buildTestTicketBuffer(text, options = {}) {
  const agentName = sanitizeText(options.agentName || "Print Agent");
  const body = sanitizeText(text || "TEST IMPRESSION");
  const content = `TEST\n${agentName}\n${separator()}${body}\n\n`;
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
