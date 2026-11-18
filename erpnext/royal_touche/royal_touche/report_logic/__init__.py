"""The portal's two reports as plain Python: no Frappe, no database.

Ports of backend/src/services/consumptionReport.service.ts (consumption) and
dailyRollReport.service.ts (daily_status). The callers read Roll Movement and Batch rows out
of ERPNext and hand them over as dicts; the shapes are documented at the top of each module.
"""
