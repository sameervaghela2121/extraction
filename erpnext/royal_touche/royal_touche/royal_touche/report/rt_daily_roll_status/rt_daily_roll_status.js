frappe.query_reports["RT Daily Roll Status"] = {
	filters: [
		{ fieldname: "date", label: __("Date"), fieldtype: "Date", reqd: 1, default: frappe.datetime.get_today() },
	],
};
