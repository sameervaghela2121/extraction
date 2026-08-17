/**
 * Test fixtures drawn from the labels photographed in the warehouse, so the endpoints are
 * exercised against the shapes they will actually meet — cm and mm widths, a material with
 * no design code, gross-only and gross+net weights.
 *
 * Clients and locations are invented; everything else is real.
 */

export const SUPPLIERS = [
  { code: "SCHATT", name: "Schattdecor", country: "Germany" },
  { code: "INTERPRINT", name: "Interprint", country: "Malaysia" },
  { code: "ITC", name: "ITC Limited — Paperboards & Specialty Papers", country: "India" },
  { code: "LAMIGRAF", name: "LamiGraf", country: "Spain" },
  { code: "MAGNETE", name: "Magnete", country: "Germany" },
  { code: "KINGDECOR", name: "KingDecor", country: "China" },
];

/** widthMm and gsm are already normalised — the labels print cm, mm and "G/M2". */
export const MATERIALS = [
  {
    supplierCode: "SCHATT",
    sku: "SCH-LAMELLA-1250-70",
    name: "Lamella",
    designCode: "14-50085-100",
    widthMm: 1250,
    gsm: 70,
    countryOfOrigin: "Germany",
    nominalWeightKg: 247,
    nominalLengthM: 2700,
  },
  {
    supplierCode: "SCHATT",
    sku: "SCH-GOLDVEINS-1250-80",
    name: "Golden Veins",
    designCode: "4000432-14-000",
    widthMm: 1250,
    gsm: 80,
    countryOfOrigin: "Germany",
    nominalWeightKg: 275,
  },
  {
    supplierCode: "INTERPRINT",
    sku: "INT-TWINKLE-1260-75",
    name: "Twinkle",
    designCode: "083860/004",
    // Label prints "126.0 cm".
    widthMm: 1260,
    gsm: 75,
    countryOfOrigin: "Malaysia",
    nominalWeightKg: 136,
    nominalLengthM: 1500,
  },
  {
    // The awkward one: no design code at all, identified by gsm and width alone.
    supplierCode: "ITC",
    sku: "ITC-WHITEBASE-1240-50",
    name: "White Base Paper 50 RL",
    widthMm: 1240,
    gsm: 50,
    coreMm: 76,
    countryOfOrigin: "India",
    nominalWeightKg: 554,
    nominalLengthM: 8560,
  },
  {
    supplierCode: "LAMIGRAF",
    sku: "LAM-02671-1250-65",
    name: "Decor Paper 02671-0344",
    designCode: "02671-0344",
    widthMm: 1250,
    gsm: 65,
    nominalWeightKg: 325,
    nominalLengthM: 3880,
  },
  {
    supplierCode: "MAGNETE",
    sku: "MAG-TISSUE-1250-18",
    name: "Tissue Paper (Overlay ADO)",
    widthMm: 1250,
    gsm: 18,
    countryOfOrigin: "Germany",
    nominalWeightKg: 217,
    nominalLengthM: 9554,
  },
  {
    supplierCode: "KINGDECOR",
    sku: "KD-JLKD5119U-1250-80",
    name: "JL-KD5119U",
    designCode: "JL-KD5119U",
    // Label prints "125" under an mm header, meaning cm.
    widthMm: 1250,
    gsm: 80,
    countryOfOrigin: "China",
  },
];

export const LOCATIONS = [
  { code: "A-01", name: "Zone A / Rack 01", zone: "A", rack: "01" },
  { code: "A-02", name: "Zone A / Rack 02", zone: "A", rack: "02" },
  { code: "B-01", name: "Zone B / Rack 01", zone: "B", rack: "01" },
  { code: "B-02", name: "Zone B / Rack 02", zone: "B", rack: "02" },
  { code: "STAGING", name: "Goods-in staging area" },
];

export const CLIENTS = [
  { code: "CL-A", name: "Client A" },
  { code: "CL-B", name: "Client B" },
  { code: "CL-C", name: "Client C" },
];

/** Real supplier order numbers off the labels. */
export const BATCHES = [
  { supplierCode: "SCHATT", code: "839322/010" },
  { supplierCode: "SCHATT", code: "919837/10" },
  { supplierCode: "INTERPRINT", code: "324100791/10" },
  { supplierCode: "ITC", code: "10972424/0" },
  { supplierCode: "LAMIGRAF", code: "OLYM 2026/01" },
  { supplierCode: "MAGNETE", code: "122179/001" },
  { supplierCode: "KINGDECOR", code: "2601E2/01" },
];

/** Whole rolls, exactly as printed — including the weight quirks each supplier has. */
export const ROLLS = [
  {
    sku: "SCH-LAMELLA-1250-70",
    batchCode: "839322/010",
    locationCode: "A-01",
    supplierRollNo: "D006175146",
    supplierOrderNo: "839322/010",
    // Schattdecor prints gross and net identically.
    grossWeightKg: 247,
    netWeightKg: 247,
    receivedWeightKg: 247,
    lengthM: 2700,
    splices: 0,
    productionDate: "22.05.2023",
  },
  {
    sku: "INT-TWINKLE-1260-75",
    batchCode: "324100791/10",
    locationCode: "A-02",
    supplierRollNo: "3081032-10",
    supplierOrderNo: "324100791/10",
    // Interprint: net and gross differ, net is the stock figure.
    grossWeightKg: 139,
    netWeightKg: 136,
    receivedWeightKg: 136,
    lengthM: 1500,
    diameterMm: 400,
    productionDate: "18.07.24",
  },
  {
    sku: "ITC-WHITEBASE-1240-50",
    batchCode: "10972424/0",
    locationCode: "B-01",
    supplierRollNo: "TGDD20050A",
    supplierReferenceNo: "TGDD20050A",
    soNumber: "10972424/0",
    ceNumber: "500002476724",
    supplierBarcodeValue: "500332350001",
    // ITC prints chargeable and gross, no net.
    grossWeightKg: 554.102,
    chargeableWeightKg: 553.902,
    receivedWeightKg: 553.902,
    lengthM: 8560,
    diameterMm: 810,
    splices: 0,
    productionDate: "21.04.2025",
  },
  {
    sku: "LAM-02671-1250-65",
    batchCode: "OLYM 2026/01",
    locationCode: "B-02",
    supplierRollNo: "2050280005040102",
    supplierBarcodeValue: "2050280005040102",
    // LamiGraf prints a single weight.
    grossWeightKg: 325,
    receivedWeightKg: 325,
    lengthM: 3880,
    areaM2: 4850,
    diameterMm: 620,
    splices: 0,
    productionDate: "14/05/2026",
  },
  {
    sku: "MAG-TISSUE-1250-18",
    batchCode: "122179/001",
    locationCode: "STAGING",
    supplierRollNo: "94660/138203/2/2",
    supplierBarcodeValue: "48732870220",
    grossWeightKg: 220,
    netWeightKg: 217,
    receivedWeightKg: 217,
    lengthM: 9554,
    productionDate: "07.02.2026",
  },
];
