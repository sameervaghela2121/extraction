import frappe
from frappe.tests import IntegrationTestCase

from royal_touche.photos import is_file_path


class TestPhotoPaths(IntegrationTestCase):
    """The shape check alone, so a bad value is refused by rule, not only because no File has
    that path."""

    def test_plain_file_names_only(self):
        for good in ("/private/files/scale-proof-085ec51.jpg", "/files/my photo (1)_a.jpg"):
            self.assertTrue(is_file_path(good), good)
        for bad in ("/files/%2e%2e\\api\\method\\x", "/files/%2e%2e", "/files/a%2fb.jpg", "/files/a\\b.jpg", "/files/a\tb.jpg",
                    "/files/a.jpg\n", "/files/.hidden", "/files/../x.jpg", "/files/a..b.jpg", "/api/method/x", "files/a.jpg",
                    "https://evil.example/x.jpg", "/private/files/", None, 5):
            self.assertFalse(is_file_path(bad), repr(bad))
