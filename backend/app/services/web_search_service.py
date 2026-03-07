"""Lightweight web search + page reading service used by chat completion."""
from __future__ import annotations

import asyncio
from html import unescape
from typing import Dict, List, Tuple
import json
import re
import time
import urllib.parse
import xml.etree.ElementTree as ET

import httpx


class WebSearchService:
    """Search provider with URL normalization, ranking, and lightweight web reader."""

    _DDG_HTML_URL = "https://html.duckduckgo.com/html/"
    _BAIDU_SEARCH_URL = "https://www.baidu.com/s"
    _WEB_SEARCH_URL = "https://www.bing.com/search"
    _NEWS_SEARCH_URL = "https://www.bing.com/news/search"
    _GOOGLE_NEWS_RSS_URL = "https://news.google.com/rss/search"
    _GOOGLE_NEWS_BATCH_URL = "https://news.google.com/_/DotsSplashUi/data/batchexecute"
    _SEARCH_TIMEOUT = httpx.Timeout(8.0, connect=2.0)
    _READ_TIMEOUT = httpx.Timeout(15.0, connect=6.0)
    _RESOLVE_TIMEOUT = httpx.Timeout(6.0, connect=2.0)
    _MAX_CANDIDATE_QUERIES = 4
    _RETRY_ATTEMPTS = 2
    _DDG_RETRY_ATTEMPTS = 1
    _CACHE_TTL_SECONDS = 900
    _ENGINE_REDIRECT_DOMAINS = {
        "baidu.com", "www.baidu.com",
        "bing.com", "www.bing.com",
        "duckduckgo.com", "html.duckduckgo.com",
        "news.google.com",
    }
    _QUERY_QUALIFIERS = {
        "latest", "news", "today", "recent", "update", "updates", "breaking", "released",
        "最新", "新闻", "今日", "最近", "进展",
    }
    _HEADERS = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
        )
    }
    _READABLE_BLOCK_RE = re.compile(
        r"<(article|main|section|div)[^>]*>(.*?)</\1>",
        re.IGNORECASE | re.DOTALL,
    )
    _TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)
    _TAG_RE = re.compile(r"<[^>]+>")
    _SCRIPT_STYLE_RE = re.compile(r"<(script|style|noscript|svg|iframe)[^>]*>.*?</\1>", re.IGNORECASE | re.DOTALL)
    _COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)
    _WHITESPACE_RE = re.compile(r"\s+")
    _DDG_LINK_RE = re.compile(
        r'<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>(.*?)</a>',
        re.IGNORECASE | re.DOTALL,
    )
    _DDG_SNIPPET_RE = re.compile(
        r'<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>(.*?)</a>|<div[^>]+class="[^"]*result__snippet[^"]*"[^>]*>(.*?)</div>',
        re.IGNORECASE | re.DOTALL,
    )
    _VERSION_RE = re.compile(r"\b\d+\.\d+\b")
    _NUMBER_RE = re.compile(r"\b\d+(?:\.\d+)?\b")
    _TOKEN_RE = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9\.\-_]{1,}")
    _CJK_BLOCK_RE = re.compile(r"[\u4e00-\u9fff]+")
    _CJK_CHAR_RE = re.compile(r"[\u4e00-\u9fff]")
    _SITE_RE = re.compile(r"\bsite:([a-z0-9\.\-]+)\b", re.IGNORECASE)
    _BAIDU_LINK_RE = re.compile(
        r"<h3[^>]*>\s*<a[^>]+href=\"([^\"]+)\"[^>]*>(.*?)</a>\s*</h3>",
        re.IGNORECASE | re.DOTALL,
    )
    _BAIDU_ANCHOR_RE = re.compile(
        r"<a[^>]+href=\"(http://www\.baidu\.com/link\?url=[^\"]+)\"[^>]*>(.*?)</a>",
        re.IGNORECASE | re.DOTALL,
    )
    _GNEWS_ID_RE = re.compile(r'data-n-a-id="([^"]+)"')
    _GNEWS_TS_RE = re.compile(r'data-n-a-ts="([^"]+)"')
    _GNEWS_SG_RE = re.compile(r'data-n-a-sg="([^"]+)"')
    _STOPWORDS = {
        "the", "a", "an", "and", "or", "for", "of", "to", "in", "on", "with",
        "what", "is", "are", "how", "about", "latest", "news", "update", "updates",
        "最近", "最新", "什么", "关于", "如何",
    }
    _LOW_VALUE_QA_DOMAINS = (
        "stackoverflow.com",
        "stackexchange.com",
        "w3schools.com",
        "geeksforgeeks.org",
        "tutorialspoint.com",
        "zhihu.com",
        "reddit.com",
        "csdn.net",
        "jianshu.com",
        "bilibili.com",
        "smartapps.baidu.com",
    )
    _BLOCK_PAGE_HINTS = (
        "captcha",
        "verify you are human",
        "too many requests",
        "pow captcha",
        "enable javascript",
        "access denied",
        "forbidden",
    )
    _SEARCH_CACHE: Dict[str, Tuple[float, List[Dict[str, str]]]] = {}

    @staticmethod
    def _clean_html_text(raw: str) -> str:
        if not raw:
            return ""
        text = WebSearchService._TAG_RE.sub(" ", raw)
        text = unescape(text)
        text = WebSearchService._WHITESPACE_RE.sub(" ", text).strip()
        return text

    @staticmethod
    def _dedupe_preserve_order(items: List[str]) -> List[str]:
        deduped: List[str] = []
        seen: set[str] = set()
        for item in items:
            value = (item or "").strip()
            if not value:
                continue
            key = value.lower()
            if key in seen:
                continue
            seen.add(key)
            deduped.append(value)
        return deduped

    @classmethod
    def _cache_key(cls, query: str, limit: int) -> str:
        return f"{query.strip().lower()}::{int(limit)}"

    @classmethod
    def _get_cached_results(cls, query: str, limit: int) -> List[Dict[str, str]]:
        key = cls._cache_key(query, limit)
        cached = cls._SEARCH_CACHE.get(key)
        if not cached:
            return []
        ts, payload = cached
        if time.time() - ts > cls._CACHE_TTL_SECONDS:
            cls._SEARCH_CACHE.pop(key, None)
            return []
        if len(payload) < 2 and len(cls._query_tokens(query)) >= 2:
            return []
        return payload

    @classmethod
    def _set_cached_results(cls, query: str, limit: int, results: List[Dict[str, str]]) -> None:
        if not results:
            return
        if len(results) < 2 and len(cls._query_tokens(query)) >= 2:
            return
        key = cls._cache_key(query, limit)
        cls._SEARCH_CACHE[key] = (time.time(), results)

    @staticmethod
    def _normalize_result_url(url: str) -> str:
        raw = (url or "").strip()
        if not raw:
            return ""

        if raw.startswith("/l/?"):
            raw = f"https://duckduckgo.com{raw}"
        elif raw.startswith("/"):
            raw = f"https://www.baidu.com{raw}"

        if raw.startswith("//"):
            raw = f"https:{raw}"

        parsed = urllib.parse.urlparse(raw)
        if not parsed.scheme:
            return raw

        query = urllib.parse.parse_qs(parsed.query)

        # DuckDuckGo redirect links: /l/?uddg=<encoded-url>
        uddg = query.get("uddg")
        if uddg and uddg[0]:
            return urllib.parse.unquote(uddg[0]).strip()

        # Bing news redirect links: /news/apiclick?...&url=<encoded-url>
        if parsed.netloc.endswith("bing.com"):
            redirect_url = query.get("url")
            if redirect_url and redirect_url[0]:
                return urllib.parse.unquote(redirect_url[0]).strip()

        return raw

    @staticmethod
    def _extract_domain(url: str) -> str:
        try:
            return urllib.parse.urlparse(url).netloc.lower()
        except Exception:
            return ""

    @classmethod
    def _is_google_news_article_url(cls, url: str) -> bool:
        try:
            parsed = urllib.parse.urlparse(url)
        except Exception:
            return False
        domain = (parsed.netloc or "").lower()
        path = (parsed.path or "").lower()
        return domain.endswith("news.google.com") and path.startswith("/rss/articles")

    @classmethod
    def _looks_like_news_query(cls, query: str) -> bool:
        q = (query or "").lower()
        keywords = (
            "latest",
            "news",
            "today",
            "recent",
            "update",
            "updates",
            "breaking",
            "release",
            "最新",
            "新闻",
            "动态",
            "最近",
            "今日",
            "发布",
            "进展",
        )
        return any(k in q for k in keywords)

    @classmethod
    def _extract_version_token(cls, query: str) -> str:
        match = cls._VERSION_RE.search(query or "")
        return match.group(0) if match else ""

    @classmethod
    def _extract_numeric_tokens(cls, query: str) -> List[str]:
        tokens = [token.strip() for token in cls._NUMBER_RE.findall(query or "")]
        # Keep meaningful numbers, ignore common tiny numbers like 0/1 when mixed queries appear.
        filtered: List[str] = []
        for token in tokens:
            if not token:
                continue
            if token in {"0", "1"}:
                continue
            filtered.append(token)
        return cls._dedupe_preserve_order(filtered)

    @staticmethod
    def _is_english_biased_query(query: str) -> bool:
        text = (query or "").strip()
        if not text:
            return False
        if WebSearchService._CJK_CHAR_RE.search(text):
            return False
        ascii_chars = sum(1 for ch in text if ord(ch) < 128)
        return (ascii_chars / max(1, len(text))) >= 0.7

    @classmethod
    def _contains_cjk(cls, text: str) -> bool:
        return bool(cls._CJK_CHAR_RE.search(text or ""))

    @classmethod
    def _query_tokens(cls, query: str) -> List[str]:
        tokens = [token.lower() for token in cls._TOKEN_RE.findall(query or "")]
        filtered: List[str] = []
        for token in tokens:
            if token in cls._STOPWORDS:
                continue
            if len(token) <= 1:
                continue
            filtered.append(token)

        for block in cls._CJK_BLOCK_RE.findall(query or ""):
            value = block.strip()
            if len(value) < 2:
                continue

            # Prefer stable anchors to avoid over-fragmenting CJK queries.
            filtered.append(value)
            if len(value) >= 4:
                filtered.append(value[: min(4, len(value))])
            if len(value) >= 2:
                filtered.append(value[-2:])

        return cls._dedupe_preserve_order(filtered)

    @classmethod
    def _extract_site_constraints(cls, query: str) -> List[str]:
        sites = [match.strip().lower() for match in cls._SITE_RE.findall(query or "")]
        return cls._dedupe_preserve_order(sites)

    @classmethod
    def _strip_query_qualifiers(cls, query: str) -> str:
        raw = (query or "").strip()
        if not raw:
            return ""

        compact = raw
        for qualifier in ("最新", "新闻", "今日", "最近", "进展"):
            compact = compact.replace(qualifier, " ")

        words = [part for part in re.split(r"\s+", compact) if part]
        filtered_words = [word for word in words if word.lower() not in cls._QUERY_QUALIFIERS]
        stripped = " ".join(filtered_words).strip()
        return stripped if stripped and stripped != raw else ""

    @classmethod
    def _build_candidate_queries(cls, query: str) -> List[str]:
        raw = (query or "").strip()
        if not raw:
            return []

        version = cls._extract_version_token(raw)
        tokens = cls._query_tokens(raw)
        news_like = cls._looks_like_news_query(raw)
        has_cjk = cls._contains_cjk(raw)
        candidates: List[str] = [raw]
        stripped = cls._strip_query_qualifiers(raw)
        if stripped:
            candidates.append(stripped)

        if has_cjk:
            if news_like:
                candidates.append(f"{raw} 最新")
                candidates.append(f"{raw} 新闻")
            if version:
                candidates.append(f"{raw} 发布说明")
                candidates.append(f"{raw} 更新日志")
        else:
            if version:
                candidates.extend(
                    [
                        f"{raw} release notes",
                        f"{raw} changelog",
                        f"{raw} docs",
                        f"{raw} official documentation",
                        f"\"{version}\" {raw}",
                    ]
                )

            if news_like:
                candidates.append(f"{raw} official announcement")
                candidates.append(f"{raw} release date")

            if len(tokens) >= 2:
                head = " ".join(tokens[:2])
                candidates.append(f"{head} official documentation")
                if news_like or version:
                    candidates.append(f"{head} release notes")
            elif len(tokens) == 1:
                token = tokens[0]
                candidates.append(f"{token} official documentation")

        return cls._dedupe_preserve_order(candidates)[: cls._MAX_CANDIDATE_QUERIES]

    @classmethod
    def _score_result(cls, query: str, item: Dict[str, str]) -> float:
        title = str(item.get("title") or "")
        snippet = str(item.get("snippet") or "")
        url = str(item.get("url") or "")
        title_l = title.lower()
        snippet_l = snippet.lower()
        url_l = url.lower()
        combined = f"{title_l} {snippet_l} {url_l}".strip()
        domain = cls._extract_domain(url)
        q_l = (query or "").lower().strip()
        site_constraints = cls._extract_site_constraints(query)

        score = 0.0
        if q_l and q_l in combined:
            score += 4.0

        tokens = cls._query_tokens(query)
        matched_tokens = 0
        for token in tokens:
            if token in title_l:
                score += 2.5
                matched_tokens += 1
            elif token in snippet_l:
                score += 1.5
                matched_tokens += 1
            elif token in url_l:
                score += 1.0
                matched_tokens += 1

        if tokens:
            coverage = matched_tokens / max(1, len(tokens))
            score += coverage * 5.0
            if len(tokens) >= 3 and matched_tokens < 2:
                score -= 6.0
            if len(tokens) >= 5 and matched_tokens < 3:
                score -= 8.0
            if len(tokens) >= 4 and coverage < 0.5:
                score -= 4.0

        version = cls._extract_version_token(query)
        if version:
            if version in combined:
                score += 8.0
            else:
                score -= 6.0

        for token in tokens:
            if token in domain:
                score += 1.5

        if domain.startswith("docs.") or ".docs." in domain:
            score += 2.5
        if domain.startswith("developer.") or ".developer." in domain:
            score += 2.0
        if domain.startswith("support.") or ".support." in domain:
            score += 1.5
        if domain.startswith("blog.") or ".blog." in domain:
            score += 1.0

        if cls._looks_like_news_query(query):
            if any(domain.endswith(d) for d in cls._LOW_VALUE_QA_DOMAINS):
                score -= 5.0
            if any(k in title_l for k in ("release", "beta", "alpha", "pep", "changelog", "what's new", "whats new")):
                score += 2.0

        if site_constraints:
            if any(domain.endswith(site) for site in site_constraints):
                score += 6.0
            else:
                score -= 6.0

        if domain and domain.count(".") <= 1 and "/" not in urllib.parse.urlparse(url).path.strip("/"):
            score -= 1.0

        if len(snippet_l) < 40:
            score -= 0.5
        return score

    @classmethod
    def _result_contains_version(cls, item: Dict[str, str], version: str) -> bool:
        if not version:
            return True
        text = f"{item.get('title', '')} {item.get('snippet', '')} {item.get('url', '')}".lower()
        return version.lower() in text

    @classmethod
    def _result_contains_any_number(cls, item: Dict[str, str], numbers: List[str]) -> bool:
        if not numbers:
            return True
        text = f"{item.get('title', '')} {item.get('snippet', '')} {item.get('url', '')}".lower()
        for num in numbers:
            escaped = re.escape(num.lower())
            # Exact numeric boundary match; allows ".0" suffix for integer-style versions.
            pattern = re.compile(rf"(?<!\d){escaped}(?:\.0+)?(?!\d)")
            if pattern.search(text):
                return True
        return False

    @classmethod
    def _token_hit_count(cls, query: str, item: Dict[str, str]) -> int:
        tokens = cls._query_tokens(query)
        if not tokens:
            return 0
        text = (
            f"{item.get('title', '')} "
            f"{item.get('snippet', '')} "
            f"{item.get('url', '')}"
        ).lower()
        return sum(1 for token in tokens if token in text)

    @classmethod
    def _looks_like_low_signal_homepage(cls, query: str, item: Dict[str, str]) -> bool:
        url = str(item.get("url") or "")
        title = str(item.get("title") or "").lower().strip()
        if not url or not title:
            return True

        parsed = urllib.parse.urlparse(url)
        path = parsed.path.strip("/")
        query_tokens = cls._query_tokens(query)
        hits = cls._token_hit_count(query, item)
        generic_title = any(
            marker in title
            for marker in ("official home page", "official homepage", "home page", "homepage", "welcome")
        )
        return (
            not path
            and len(query_tokens) >= 3
            and hits == 0
            and (generic_title or len(title) <= 30)
        )

    @classmethod
    def _is_block_page(cls, text: str, status_code: int) -> bool:
        body = (text or "").lower()
        if status_code in {401, 403, 429}:
            return True
        return any(pattern in body for pattern in cls._BLOCK_PAGE_HINTS)

    @staticmethod
    def _is_engine_internal_url(url: str) -> bool:
        try:
            parsed = urllib.parse.urlparse(url)
        except Exception:
            return False
        domain = (parsed.netloc or "").lower()
        path = (parsed.path or "").lower()
        if not domain:
            return True
        if domain.endswith("news.google.com") and path.startswith("/rss/articles"):
            return False
        if domain.endswith("baidu.com") and not path.startswith("/link"):
            return True
        if domain.endswith("bing.com") and path.startswith("/search"):
            return True
        if domain.endswith("duckduckgo.com") and path.startswith("/?q="):
            return True
        return False

    @classmethod
    def _has_sufficient_results(cls, query: str, results: List[Dict[str, str]], limit: int) -> bool:
        direct_results = [
            item for item in results
            if item.get("url") and not cls._is_engine_internal_url(str(item.get("url") or ""))
        ]
        if not direct_results:
            return False

        target = min(limit, 4)
        if cls._looks_like_news_query(query) or cls._extract_version_token(query):
            target = min(limit, 3)
        return len(direct_results) >= max(2, target)

    @classmethod
    def _rerank_results(cls, query: str, results: List[Dict[str, str]], limit: int) -> List[Dict[str, str]]:
        best_by_url: Dict[str, Tuple[float, Dict[str, str]]] = {}
        fallback_by_url: Dict[str, Tuple[float, Dict[str, str]]] = {}
        query_tokens = cls._query_tokens(query)
        for item in results:
            url = cls._normalize_result_url(str(item.get("url") or ""))
            title = str(item.get("title") or "").strip()
            if not url or not title:
                continue
            normalized_item = {
                "title": title[:300],
                "url": url,
                "snippet": str(item.get("snippet") or "").strip()[:500],
            }
            if cls._is_engine_internal_url(url):
                continue
            score = cls._score_result(query, normalized_item)
            token_hits = cls._token_hit_count(query, normalized_item)
            if token_hits > 0 or len(query_tokens) <= 1:
                prev_fallback = fallback_by_url.get(url)
                if prev_fallback is None or score > prev_fallback[0]:
                    fallback_by_url[url] = (score, normalized_item)

            if len(query_tokens) >= 2 and token_hits == 0:
                continue
            if cls._looks_like_low_signal_homepage(query, normalized_item):
                continue
            prev = best_by_url.get(url)
            if prev is None or score > prev[0]:
                best_by_url[url] = (score, normalized_item)

        if not best_by_url and fallback_by_url:
            best_by_url = fallback_by_url

        scored = sorted(best_by_url.values(), key=lambda x: x[0], reverse=True)
        if not scored:
            return []

        version = cls._extract_version_token(query)
        if version:
            with_exact_version = [item for item in scored if cls._result_contains_version(item[1], version)]
            if with_exact_version:
                scored = with_exact_version
            else:
                # Keep fallback candidates when exact-version recall is poor on current providers.
                scored = [(score - 3.0, payload) for score, payload in scored]

        number_tokens = cls._extract_numeric_tokens(query)
        if number_tokens:
            # Treat likely version numbers as hard constraints, years as soft constraints.
            hard_numbers = [n for n in number_tokens if "." in n or len(n) <= 3]
            if hard_numbers:
                with_numbers = [item for item in scored if cls._result_contains_any_number(item[1], hard_numbers)]
                if with_numbers:
                    desired = min(limit, 3)
                    if len(with_numbers) >= desired:
                        scored = with_numbers
                    else:
                        existing_urls = {entry[1].get("url") for entry in with_numbers}
                        extras: List[Tuple[float, Dict[str, str]]] = []
                        for entry in scored:
                            url = entry[1].get("url")
                            if url in existing_urls:
                                continue
                            extras.append(entry)
                            if len(extras) >= desired - len(with_numbers):
                                break
                        scored = [*with_numbers, *extras]
                else:
                    # Soft fallback: keep candidates but reduce confidence.
                    scored = [(score - 2.5, payload) for score, payload in scored]

        non_negative = [item for item in scored if item[0] >= 0]
        pool = non_negative if non_negative else scored
        if cls._looks_like_news_query(query):
            non_qa = [
                item for item in pool
                if not any(cls._extract_domain(item[1].get("url", "")).endswith(d) for d in cls._LOW_VALUE_QA_DOMAINS)
            ]
            if non_qa:
                pool = non_qa

        tokens = cls._query_tokens(query)
        min_score = 0.0
        if len(tokens) >= 5:
            min_score = 2.0
        elif len(tokens) >= 3:
            min_score = 1.0

        qualified = [entry for entry in pool if entry[0] >= min_score]
        if qualified:
            pool = qualified

        selected: List[Dict[str, str]] = []
        domain_counts: Dict[str, int] = {}
        for _, item in pool:
            domain = cls._extract_domain(item.get("url", ""))
            domain_limit = 4 if domain in cls._ENGINE_REDIRECT_DOMAINS else 2
            if domain and domain_counts.get(domain, 0) >= domain_limit:
                continue
            selected.append(item)
            if domain:
                domain_counts[domain] = domain_counts.get(domain, 0) + 1
            if len(selected) >= limit:
                break

        if selected:
            return selected
        return [item for _, item in pool[:limit]]

    @classmethod
    def _rerank_results_loose(cls, query: str, results: List[Dict[str, str]], limit: int) -> List[Dict[str, str]]:
        best_by_url: Dict[str, Tuple[float, Dict[str, str]]] = {}
        query_tokens = cls._query_tokens(query)

        for item in results:
            url = cls._normalize_result_url(str(item.get("url") or ""))
            title = str(item.get("title") or "").strip()
            if not url or not title:
                continue
            if cls._is_engine_internal_url(url):
                continue

            normalized_item = {
                "title": title[:300],
                "url": url,
                "snippet": str(item.get("snippet") or "").strip()[:500],
            }
            token_hits = cls._token_hit_count(query, normalized_item)
            if len(query_tokens) >= 2 and token_hits == 0:
                continue

            score = cls._score_result(query, normalized_item)
            prev = best_by_url.get(url)
            if prev is None or score > prev[0]:
                best_by_url[url] = (score, normalized_item)

        if not best_by_url:
            return []

        scored = sorted(best_by_url.values(), key=lambda x: x[0], reverse=True)
        selected: List[Dict[str, str]] = []
        domain_counts: Dict[str, int] = {}
        for _, item in scored:
            domain = cls._extract_domain(item.get("url", ""))
            limit_per_domain = 3
            if domain and domain_counts.get(domain, 0) >= limit_per_domain:
                continue
            selected.append(item)
            if domain:
                domain_counts[domain] = domain_counts.get(domain, 0) + 1
            if len(selected) >= limit:
                break

        return selected

    def _parse_results_from_bing_rss(self, xml_content: str, limit: int) -> List[Dict[str, str]]:
        parsed: List[Dict[str, str]] = []
        seen_urls: set[str] = set()

        try:
            root = ET.fromstring(xml_content or "")
        except ET.ParseError:
            return []

        for item in root.findall(".//item"):
            if len(parsed) >= limit:
                break

            title = self._clean_html_text(item.findtext("title") or "")
            url = self._normalize_result_url((item.findtext("link") or "").strip())
            snippet = self._clean_html_text(item.findtext("description") or "")

            if not title or not url or url in seen_urls:
                continue

            seen_urls.add(url)
            parsed.append(
                {
                    "title": title[:300],
                    "url": url,
                    "snippet": snippet[:500],
                }
            )

        return parsed

    def _parse_results_from_ddg_html(self, html: str, limit: int) -> List[Dict[str, str]]:
        items: List[Dict[str, str]] = []
        seen_urls: set[str] = set()
        if not html:
            return items

        links = self._DDG_LINK_RE.findall(html)
        snippets = self._DDG_SNIPPET_RE.findall(html)
        snippet_list = [
            self._clean_html_text(first or second or "")
            for (first, second) in snippets
        ]

        for idx, (href, title_html) in enumerate(links):
            if len(items) >= limit:
                break
            url = self._normalize_result_url(unescape(href))
            title = self._clean_html_text(title_html)
            if not url or not title:
                continue
            if url in seen_urls:
                continue
            seen_urls.add(url)
            snippet = snippet_list[idx] if idx < len(snippet_list) else ""
            items.append(
                {
                    "title": title[:300],
                    "url": url,
                    "snippet": snippet[:500],
                }
            )

        return items

    def _parse_results_from_baidu_html(self, html: str, limit: int) -> List[Dict[str, str]]:
        items: List[Dict[str, str]] = []
        seen_urls: set[str] = set()
        if not html:
            return items

        def append_items(pairs: List[Tuple[str, str]]) -> None:
            for href, title_html in pairs:
                if len(items) >= limit:
                    break
                url = self._normalize_result_url(unescape(href))
                title = self._clean_html_text(title_html)
                if not url or not title:
                    continue
                if len(title) < 4:
                    continue
                if any(noise in title.lower() for noise in ("百度首页", "百度一下", "更多结果")):
                    continue
                if url in seen_urls:
                    continue

                seen_urls.add(url)
                items.append(
                    {
                        "title": title[:300],
                        "url": url,
                        "snippet": "",
                    }
                )

        append_items(self._BAIDU_LINK_RE.findall(html))
        if len(items) < max(3, limit // 2):
            append_items(self._BAIDU_ANCHOR_RE.findall(html))

        return items

    async def _search_ddg(
        self,
        client: httpx.AsyncClient,
        query: str,
        limit: int,
        english_bias: bool,
    ) -> List[Dict[str, str]]:
        params = {"q": query}
        if english_bias:
            params["kl"] = "us-en"

        for _ in range(self._DDG_RETRY_ATTEMPTS):
            try:
                response = await client.get(self._DDG_HTML_URL, params=params)
                if self._is_block_page(response.text, response.status_code):
                    continue
                response.raise_for_status()
                parsed = self._parse_results_from_ddg_html(response.text, limit)
                if parsed:
                    return parsed
            except Exception:
                continue
        return []

    async def _search_baidu_html(
        self,
        client: httpx.AsyncClient,
        query: str,
        limit: int,
    ) -> List[Dict[str, str]]:
        for _ in range(self._RETRY_ATTEMPTS):
            try:
                response = await client.get(self._BAIDU_SEARCH_URL, params={"wd": query})
                if self._is_block_page(response.text, response.status_code):
                    continue
                response.raise_for_status()
                parsed = self._parse_results_from_baidu_html(response.text, limit)
                if parsed:
                    return parsed
            except Exception:
                continue
        return []

    async def _search_bing_rss(
        self,
        client: httpx.AsyncClient,
        query: str,
        limit: int,
        news: bool,
        english_bias: bool,
    ) -> List[Dict[str, str]]:
        search_url = self._NEWS_SEARCH_URL if news else self._WEB_SEARCH_URL
        params = {"q": query, "format": "rss"}
        if english_bias:
            params["setlang"] = "en-US"
            params["cc"] = "US"

        for _ in range(self._RETRY_ATTEMPTS):
            try:
                response = await client.get(search_url, params=params)
                if self._is_block_page(response.text, response.status_code):
                    continue
                response.raise_for_status()
                parsed = self._parse_results_from_bing_rss(response.text, limit)
                if parsed:
                    return parsed
            except Exception:
                continue
        return []

    async def _search_google_news_rss(
        self,
        client: httpx.AsyncClient,
        query: str,
        limit: int,
        english_bias: bool,
    ) -> List[Dict[str, str]]:
        params = {"q": query}
        if english_bias:
            params.update({"hl": "en-US", "gl": "US", "ceid": "US:en"})
        else:
            params.update({"hl": "zh-CN", "gl": "CN", "ceid": "CN:zh-Hans"})

        for _ in range(self._RETRY_ATTEMPTS):
            try:
                response = await client.get(self._GOOGLE_NEWS_RSS_URL, params=params)
                if self._is_block_page(response.text, response.status_code):
                    continue
                response.raise_for_status()
                parsed = self._parse_results_from_bing_rss(response.text, limit)
                if parsed:
                    return parsed
            except Exception:
                continue
        return []

    async def _resolve_redirect_url(self, client: httpx.AsyncClient, url: str) -> str:
        normalized = self._normalize_result_url(url)
        if not normalized:
            return ""

        parsed = urllib.parse.urlparse(normalized)
        domain = parsed.netloc.lower()
        if domain not in self._ENGINE_REDIRECT_DOMAINS:
            return normalized

        if self._is_google_news_article_url(normalized):
            return await self._decode_google_news_rss_url(client, normalized)

        try:
            response = await client.head(normalized, follow_redirects=True)
            if response.status_code < 400:
                final_url = str(response.url)
                return self._normalize_result_url(final_url) or normalized
        except Exception:
            pass

        try:
            response = await client.get(normalized, follow_redirects=True)
            if response.status_code < 400:
                final_url = str(response.url)
                return self._normalize_result_url(final_url) or normalized
        except Exception:
            pass

        return normalized

    async def _decode_google_news_rss_url(self, client: httpx.AsyncClient, url: str) -> str:
        normalized = self._normalize_result_url(url)
        if not self._is_google_news_article_url(normalized):
            return normalized

        try:
            page_response = await client.get(normalized)
            if self._is_block_page(page_response.text, page_response.status_code):
                return normalized
            page_response.raise_for_status()
            page_html = page_response.text or ""

            article_id_match = self._GNEWS_ID_RE.search(page_html)
            timestamp_match = self._GNEWS_TS_RE.search(page_html)
            signature_match = self._GNEWS_SG_RE.search(page_html)
            if not article_id_match or not timestamp_match or not signature_match:
                return normalized

            article_id = article_id_match.group(1)
            timestamp = timestamp_match.group(1)
            signature = signature_match.group(1)
            rpc_request = [[
                "Fbv4je",
                (
                    '["garturlreq",'
                    '[[\"X\",\"X\",[\"X\",\"X\"],null,null,1,1,\"US:en\",null,1,null,null,null,null,null,0,1],'
                    f'\"X\",\"X\",1,[1,1,1],1,1,null,0,0,null,0],\"{article_id}\",{timestamp},\"{signature}\"]'
                ),
            ]]
            payload = f"f.req={urllib.parse.quote(json.dumps([rpc_request]))}"
            batch_response = await client.post(
                self._GOOGLE_NEWS_BATCH_URL,
                headers={
                    **self._HEADERS,
                    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                    "X-Same-Domain": "1",
                },
                content=payload,
            )
            if self._is_block_page(batch_response.text, batch_response.status_code):
                return normalized
            batch_response.raise_for_status()

            parts = batch_response.text.split("\n\n", 1)
            if len(parts) != 2:
                return normalized

            payload_rows = json.loads(parts[1])
            for row in payload_rows:
                if not isinstance(row, list) or len(row) < 3:
                    continue
                if row[0] != "wrb.fr" or row[1] != "Fbv4je":
                    continue
                decoded_payload = json.loads(row[2])
                if not isinstance(decoded_payload, list) or len(decoded_payload) < 2:
                    continue
                decoded_url = self._normalize_result_url(str(decoded_payload[1] or ""))
                if decoded_url and not self._is_google_news_article_url(decoded_url):
                    return decoded_url
        except Exception:
            return normalized

        return normalized

    async def _resolve_result_urls(self, items: List[Dict[str, str]]) -> List[Dict[str, str]]:
        if not items:
            return []

        needs_resolve = []
        for item in items:
            url = self._normalize_result_url(str(item.get("url") or ""))
            domain = self._extract_domain(url)
            parsed = urllib.parse.urlparse(url)
            if domain in self._ENGINE_REDIRECT_DOMAINS or (domain.endswith("baidu.com") and parsed.path.startswith("/link")):
                needs_resolve.append(True)
            else:
                needs_resolve.append(False)

        if not any(needs_resolve):
            return items

        async with httpx.AsyncClient(
            timeout=self._RESOLVE_TIMEOUT,
            headers=self._HEADERS,
            follow_redirects=True,
        ) as client:
            tasks = [
                asyncio.create_task(self._resolve_redirect_url(client, str(item.get("url") or "")))
                if needs else None
                for item, needs in zip(items, needs_resolve)
            ]
            resolved_urls: List[str] = []
            for task, item in zip(tasks, items):
                if task is None:
                    resolved_urls.append(self._normalize_result_url(str(item.get("url") or "")))
                    continue
                try:
                    resolved_urls.append(await task)
                except Exception:
                    resolved_urls.append(self._normalize_result_url(str(item.get("url") or "")))

        merged: List[Dict[str, str]] = []
        unresolved_redirect_results: List[Dict[str, str]] = []
        seen: set[str] = set()
        for item, resolved_url in zip(items, resolved_urls):
            final_url = self._normalize_result_url(resolved_url)
            if not final_url:
                continue
            parsed_final = urllib.parse.urlparse(final_url)
            final_domain = self._extract_domain(final_url)
            if self._is_google_news_article_url(final_url) or (
                final_domain.endswith("baidu.com") and parsed_final.path.startswith("/link")
            ):
                unresolved_redirect_results.append(
                    {
                        "title": str(item.get("title") or "")[:300],
                        "url": final_url,
                        "snippet": str(item.get("snippet") or "")[:500],
                    }
                )
                continue
            if self._is_engine_internal_url(final_url):
                original_url = self._normalize_result_url(str(item.get("url") or ""))
                if original_url and not self._is_engine_internal_url(original_url):
                    final_url = original_url
                else:
                    continue
            if final_url in seen:
                continue
            seen.add(final_url)
            merged.append(
                {
                    "title": str(item.get("title") or "")[:300],
                    "url": final_url,
                    "snippet": str(item.get("snippet") or "")[:500],
                }
            )
        if merged:
            return merged
        return unresolved_redirect_results

    async def search(self, query: str, limit: int = 5) -> List[Dict[str, str]]:
        text = (query or "").strip()
        if not text:
            return []

        limit = max(1, min(20, int(limit)))
        cached = self._get_cached_results(text, limit)
        fetch_limit = max(10, min(30, limit * 3))
        candidate_queries = self._build_candidate_queries(text)
        if not candidate_queries:
            return cached
        english_bias = self._is_english_biased_query(text)
        has_cjk = self._contains_cjk(text)
        query_is_news = self._looks_like_news_query(text)

        gathered: List[Dict[str, str]] = []
        early_resolved_results: List[Dict[str, str]] = []
        try:
            async with httpx.AsyncClient(
                timeout=self._SEARCH_TIMEOUT,
                headers=self._HEADERS,
                follow_redirects=True,
            ) as client:
                for idx, candidate in enumerate(candidate_queries):
                    candidate_is_news = self._looks_like_news_query(candidate)
                    tasks: List[asyncio.Task] = [
                        asyncio.create_task(
                            self._search_ddg(client, candidate, fetch_limit, english_bias=english_bias)
                        )
                    ]
                    if has_cjk or idx == 0:
                        tasks.append(
                            asyncio.create_task(self._search_baidu_html(client, candidate, fetch_limit))
                        )

                    # Bing RSS is kept as fallback because quality varies by region/query.
                    if idx == 0 or len(gathered) < fetch_limit:
                        if candidate_is_news or query_is_news:
                            tasks.append(
                                asyncio.create_task(
                                    self._search_bing_rss(
                                        client,
                                        candidate,
                                        fetch_limit,
                                        news=True,
                                        english_bias=english_bias,
                                    )
                                )
                            )
                            tasks.append(
                                asyncio.create_task(
                                    self._search_google_news_rss(
                                        client,
                                        candidate,
                                        fetch_limit,
                                        english_bias=english_bias,
                                    )
                                )
                            )
                        else:
                            tasks.append(
                                asyncio.create_task(
                                    self._search_bing_rss(
                                        client,
                                        candidate,
                                        fetch_limit,
                                        news=False,
                                        english_bias=english_bias,
                                    )
                                )
                            )

                    results = await asyncio.gather(*tasks, return_exceptions=True)
                    for result in results:
                        if isinstance(result, list):
                            gathered.extend(result)

                    preview_ranked = self._rerank_results(text, gathered, max(limit, 4))
                    if preview_ranked:
                        preview_resolved = await self._resolve_result_urls(preview_ranked)
                        if self._has_sufficient_results(text, preview_resolved, limit):
                            early_resolved_results = preview_resolved
                            break

                    # Avoid overfetch once we have enough candidates.
                    if len(gathered) >= fetch_limit * 3 and idx > 0:
                        break

                if not gathered:
                    fallback_tasks: List[asyncio.Task] = [
                        asyncio.create_task(self._search_ddg(client, text, fetch_limit, english_bias=english_bias)),
                        asyncio.create_task(self._search_google_news_rss(client, text, fetch_limit, english_bias=english_bias)),
                    ]
                    if query_is_news:
                        fallback_tasks.append(
                            asyncio.create_task(self._search_bing_rss(client, text, fetch_limit, news=True, english_bias=english_bias))
                        )
                    else:
                        fallback_tasks.append(
                            asyncio.create_task(self._search_bing_rss(client, text, fetch_limit, news=False, english_bias=english_bias))
                        )
                    if has_cjk:
                        fallback_tasks.append(
                            asyncio.create_task(self._search_baidu_html(client, text, fetch_limit))
                        )
                    fallback_results = await asyncio.gather(*fallback_tasks, return_exceptions=True)
                    for result in fallback_results:
                        if isinstance(result, list):
                            gathered.extend(result)
        except Exception:
            return cached

        resolved = early_resolved_results
        if not resolved:
            ranked = self._rerank_results(text, gathered, limit)
            resolved = await self._resolve_result_urls(ranked)
        final_results = resolved[:limit]
        if not final_results and gathered:
            loose_ranked = self._rerank_results_loose(text, gathered, limit)
            loose_resolved = await self._resolve_result_urls(loose_ranked)
            final_results = loose_resolved[:limit]
        if final_results:
            self._set_cached_results(text, limit, final_results)
            return final_results
        return cached

    def _extract_readable_text(self, html: str, max_chars: int) -> str:
        if not html:
            return ""

        cleaned = self._COMMENT_RE.sub(" ", html)
        cleaned = self._SCRIPT_STYLE_RE.sub(" ", cleaned)

        candidates = self._READABLE_BLOCK_RE.findall(cleaned)
        if candidates:
            longest_block = max((content for _, content in candidates), key=len, default="")
        else:
            longest_block = cleaned

        block = re.sub(
            r"</(p|div|section|article|main|li|h1|h2|h3|h4|h5|h6|br)>",
            "\n",
            longest_block,
            flags=re.IGNORECASE,
        )
        text = self._clean_html_text(block)
        if len(text) > max_chars:
            return text[:max_chars]
        return text

    async def read_url(self, url: str, max_chars: int = 12000) -> Dict[str, str]:
        normalized_url = self._normalize_result_url(url)
        if not normalized_url:
            return {
                "url": "",
                "final_url": "",
                "title": "",
                "content": "",
                "error": "invalid_url",
            }

        max_chars = max(1000, min(50000, int(max_chars)))
        try:
            async with httpx.AsyncClient(
                timeout=self._READ_TIMEOUT,
                headers=self._HEADERS,
                follow_redirects=True,
            ) as client:
                if self._is_google_news_article_url(normalized_url):
                    normalized_url = await self._decode_google_news_rss_url(client, normalized_url)
                response = await client.get(normalized_url)
                response.raise_for_status()
        except Exception as exc:
            return {
                "url": normalized_url,
                "final_url": normalized_url,
                "title": "",
                "content": "",
                "error": str(exc),
            }

        final_url = str(response.url)
        content_type = (response.headers.get("content-type") or "").lower()
        body = response.text or ""

        if "application/json" in content_type:
            try:
                data = response.json()
                content = json.dumps(data, ensure_ascii=False)[:max_chars]
            except Exception:
                content = body[:max_chars]
            return {
                "url": normalized_url,
                "final_url": final_url,
                "title": final_url,
                "content": content,
            }

        if "text/html" not in content_type and content_type:
            return {
                "url": normalized_url,
                "final_url": final_url,
                "title": final_url,
                "content": body[:max_chars],
            }

        title_match = self._TITLE_RE.search(body)
        title = self._clean_html_text(title_match.group(1) if title_match else "") or final_url
        content = self._extract_readable_text(body, max_chars)
        error = None
        if not content.strip():
            error = "empty_content"

        return {
            "url": normalized_url,
            "final_url": final_url,
            "title": title[:300],
            "content": content,
            "error": error,
        }


web_search_service = WebSearchService()
