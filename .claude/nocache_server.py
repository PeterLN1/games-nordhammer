import http.server

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Clear-Site-Data", '"cache"')
        super().end_headers()

if __name__ == "__main__":
    http.server.test(HandlerClass=NoCacheHandler, port=8934)
