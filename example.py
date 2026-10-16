import os
import sys

from scrapegraphai.graphs import SmartScraperGraph

url = sys.argv[1] if len(sys.argv) > 1 else "https://example.com"
prompt = sys.argv[2] if len(sys.argv) > 2 else "Summarize this page"

loader_kwargs = {}
# Claude cloud sessions ship their own Chromium and route traffic through a proxy.
if os.path.exists("/opt/pw-browsers/chromium"):
    loader_kwargs["executable_path"] = "/opt/pw-browsers/chromium"
if os.environ.get("HTTPS_PROXY"):
    loader_kwargs["proxy"] = {"server": os.environ["HTTPS_PROXY"]}

config = {
    "llm": {"model": "google_genai/gemini-flash-latest", "api_key": os.environ["GOOGLE_API_KEY"]},
    "loader_kwargs": loader_kwargs,
    "headless": True,
}

print(SmartScraperGraph(prompt=prompt, source=url, config=config).run())
