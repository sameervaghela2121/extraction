import qz from "qz-tray";

/**
 * Direct printing via QZ Tray — a small app the operator installs once on the computer
 * physically wired to the barcode printer. It exposes a local websocket the browser can
 * talk to, which is the only way a web page reaches a USB device at all; nothing here
 * touches the backend, since a Cloud Run server has no route to hardware on someone's desk.
 *
 * No signing certificate is configured, so QZ Tray shows its own one-time "allow this site
 * to print?" prompt rather than printing silently. That's a deliberate, temporary choice —
 * see BarcodeGeneratorPage.tsx — not a limitation of this module.
 *
 * Every step logs under the "[barcode-print]" tag — this is the one part of the app that
 * fails on hardware and setup outside our control (QZ Tray not running, wrong driver, printer
 * off), so the console is the fastest way for whoever's on-site with the printer to see
 * which step it got stuck on, filterable in DevTools with that tag.
 */
const LOG = "[barcode-print]";

/** Idempotent: does nothing if a connection is already open. Throws QZ Tray's own error
 *  (e.g. "Unable to establish connection with QZ") if the app isn't running, which callers
 *  should show to the operator rather than swallow — the fix is "start QZ Tray," not code. */
export async function ensureConnected(): Promise<void> {
  if (qz.websocket.isActive()) {
    console.log(`${LOG} already connected to QZ Tray`);
    return;
  }
  console.log(`${LOG} connecting to QZ Tray on localhost…`);
  try {
    await qz.websocket.connect();
    console.log(`${LOG} connected to QZ Tray`);
  } catch (err) {
    console.error(`${LOG} could not connect to QZ Tray — is it installed and running?`, err);
    throw err;
  }
}

/** Every printer QZ Tray can see on this computer — populates the picker rather than
 *  asking the operator to type a driver name exactly right. */
export async function listPrinters(): Promise<string[]> {
  await ensureConnected();
  console.log(`${LOG} asking QZ Tray for connected printers…`);
  try {
    const found = await qz.printers.find();
    const names = Array.isArray(found) ? found : [found];
    console.log(`${LOG} printers found:`, names);
    return names;
  } catch (err) {
    console.error(`${LOG} printers.find() failed`, err);
    throw err;
  }
}

/**
 * Send raw printer commands (ZPL) straight to a printer, skipping the download-and-print-
 * dialog step entirely.
 *
 * Resolves once QZ Tray has accepted the job — not once the sticker has physically come out
 * of the printer. A stuck roll or an empty label stock still shows as success here.
 */
export async function printRaw(printerName: string, commands: string): Promise<void> {
  await ensureConnected();
  console.log(`${LOG} sending job to "${printerName}" (${commands.length} bytes of ZPL)`);
  console.log(`${LOG} ZPL payload:\n${commands}`);
  try {
    const config = qz.configs.create(printerName);
    await qz.print(config, [commands]);
    console.log(`${LOG} QZ Tray accepted the job for "${printerName}"`);
  } catch (err) {
    console.error(`${LOG} qz.print() failed for "${printerName}"`, err);
    throw err;
  }
}
