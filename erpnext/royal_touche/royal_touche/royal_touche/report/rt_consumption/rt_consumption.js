frappe.query_reports["RT Consumption"] = {
	filters: [
		{ fieldname: "from_date", label: __("From"), fieldtype: "Date", reqd: 1, default: frappe.datetime.month_start() },
		{ fieldname: "to_date", label: __("To"), fieldtype: "Date", reqd: 1, default: frappe.datetime.get_today() },
		{ fieldname: "group", label: __("By"), fieldtype: "Select", options: "material\ndesign", default: "material" },
	],
};
