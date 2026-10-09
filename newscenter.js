/*

NewsCenter                     ▄ ▄ ▄
for Synchronet                 █████
Version 0.261002               ▐▄█▄▌ cf
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
by Craig Hendricks
codefenix@conchaos.synchro.net

ConstructiveChaos BBS:
  https://conchaos.synchro.net
 telnet://conchaos.synchro.net
    ssh://conchaos.synchro.net

*/

load("sbbsdefs.js");
load("rss-curl.js");
load("http.js");
load("frame.js");
require("html2asc.js", 'html2asc');
require("dd_lightbar_menu.js", "DDLightbarMenu");

const VERSION = "0.261002";
const EXEC_PATH = backslash(js.exec_dir);
const SCROLLER_PATH = "../xtrn/scroller/scroller.js";
const SCROLLER_CMD_FMT = '?%s "%s" "%s" %s';
const TEMP_PATH = EXEC_PATH + "temp" + bbs.node_num;
const WIDTH = console.screen_columns;
const HEIGHT = console.screen_rows;
const HDR_FILE = "newscenter" + (WIDTH >= 132 ? "_wide": "") + ".msg";
const DIVIDER = "\x01n\x01b" + (new Array(WIDTH).join(ascii(196))) + "\x01n";
const BW_TEXT = false;
const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0";
const FETCH_ATTEMPTS = 3;
const USE_CURL = true;          // download articles with the external curl program first (see fetchPageCurl)
const CURL_CMD = "curl";        // full path to curl if it isn't in the sbbs process's PATH

function displayText(article_text, article_title) {
    const TEMP_NEWS_FILE = backslash(TEMP_PATH) + "temp-news.msg";
    var ftext = new File(TEMP_NEWS_FILE);
    ftext.open("w", false);
    ftext.write(article_text + "\x01n\x01b\x01h/===END===/" );
    ftext.close();
    if (file_exists(SCROLLER_PATH)) {
        bbs.exec( format(SCROLLER_CMD_FMT, SCROLLER_PATH, TEMP_NEWS_FILE, article_title.replace(/[^a-zA-Z0-9 \-,.'":!\@#$%\^&\*\(\)\[\]]/g, ""), "top" ), 0, EXEC_PATH );
    } else {
        console.clear(false);
        console.printfile(TEMP_NEWS_FILE);        
        console.pause();                    
    }                               
    // file_remove(TEMP_NEWS_FILE);
}

/*
 * Pulls the article body out of a raw HTML page, preferring schema.org
 * JSON-LD structured data (NewsArticle/Article/BlogPosting.articleBody)
 * when a site provides it, since that's the cleanest, most reliable
 * source when present - no heuristics, no risk of grabbing nav/ad text.
 */
function extractJsonLdArticleBody(html) {
    var scripts = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
    if (!scripts)
        return null;
    for (var i = 0; i < scripts.length; i++) {
        var jsonText = scripts[i].replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "").trim();
        try {
            var data = JSON.parse(jsonText);
            var candidates = Array.isArray(data) ? data : (data["@graph"] || [data]);
            for (var j = 0; j < candidates.length; j++) {
                var node = candidates[j];
                if (!node || !node["@type"])
                    continue;
                var type = node["@type"];
                var isArticle = (type === "NewsArticle" || type === "Article" || type === "BlogPosting") ||
                    (Array.isArray(type) && type.join(",").match(/Article|BlogPosting/));
                if (isArticle && node.articleBody)
                    return node.articleBody;
            }
        } catch (e) {
            // malformed JSON-LD block on this particular page; keep looking at the others
        }
    }
    return null;
}

/*
 * Finds the offset of the tag that closes the one opened at searchFrom,
 * respecting nesting. A simple non-greedy regex can't do this correctly
 * once a page has nested <div>s of the same tag name.
 */
function findMatchingCloseTag(html, tagName, searchFrom) {
    var openRe = new RegExp("<" + tagName + "(\\s[^>]*)?>", "ig");
    var closeRe = new RegExp("<\\/" + tagName + "\\s*>", "ig");
    var depth = 1, pos = searchFrom;
    while (depth > 0) {
        openRe.lastIndex = pos;
        closeRe.lastIndex = pos;
        var om = openRe.exec(html);
        var cm = closeRe.exec(html);
        if (!cm)
            return html.length; // unbalanced/malformed HTML; just take the rest of the document
        if (om && om.index < cm.index) {
            depth++;
            pos = om.index + om[0].length;
        } else {
            depth--;
            pos = cm.index + cm[0].length;
            if (depth === 0)
                return cm.index;
        }
    }
    return html.length;
}

/*
 * Fallback for pages without JSON-LD: scans likely content containers
 * and picks whichever has the most paragraph text relative to its
 * overall markup size, on the theory that boilerplate (nav, sidebars,
 * related-story widgets) is markup-heavy/text-light and the real
 * article body is the opposite.
 */
function findMainContentBlock(html) {
    var candidates = ["article", "main", "div", "section"];
    var best = null, bestScore = 0;
    for (var t = 0; t < candidates.length; t++) {
        var re = new RegExp("<" + candidates[t] + "(\\s[^>]*)?>", "ig");
        var m;
        while ((m = re.exec(html)) !== null) {
            var contentStart = m.index + m[0].length;
            var contentEnd = findMatchingCloseTag(html, candidates[t], contentStart);
            var block = html.substring(contentStart, contentEnd);
            var pMatches = block.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
            var textLen = 0;
            for (var i = 0; i < pMatches.length; i++)
                textLen += pMatches[i].replace(/<[^>]+>/g, "").length;
            var density = textLen / Math.max(block.length, 1);
            var score = textLen * (density > 0.15 ? 1 : 0.5); // penalize markup-heavy blocks
            if (score > bestScore) {
                bestScore = score;
                best = block;
            }
            re.lastIndex = contentEnd; // skip past this block so nested containers aren't double-counted
        }
    }
    return bestScore < 200 ? null : best; // not confident enough below this floor
}

/*
 * Best-effort extraction of the article body from a raw HTML page,
 * scraped directly from the source rather than relying on a
 * third-party stripping service.
 */
function scrapeArticleText(html) {
    var jsonLdBody = extractJsonLdArticleBody(html);
    if (jsonLdBody)
        return jsonLdBody;

    var cleaned = html
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/<(script|style|noscript|svg|form|button|nav|header|footer|aside|iframe)[^>]*>[\s\S]*?<\/\1>/gi, "");

    var block = findMainContentBlock(cleaned);
    return block || cleaned; // last resort: hand the whole cleaned page to html2asc
}

/*
 * Downloads a page by shelling out to curl. Returns
 * the page text, or null on any failure. Used because Synchronet's built-in
 * TLS client (cryptlib) fails some HTTPS handshakes ("Unable to read status")
 * that curl handles fine.
 *
 * The URL comes from a remote feed, so it's untrusted. Anything outside a
 * conservative URL character set is percent-encoded, and the whole thing is
 * wrapped in quotes, so it can't break out into the shell.
 */
function fetchPageCurl(url, out_file) {
    if (!/^https?:\/\//i.test(url))
        return null;
    var win = /win/i.test(system.platform);
    if (win && url.indexOf("%") >= 0)   // cmd.exe would expand %VAR% inside quotes
        return null;
    var safe_url = url.replace(/[^A-Za-z0-9\-._~:\/?#@=&+,;%]/g, function (c) {
        var code = c.charCodeAt(0);
        return code < 256 ? "%" + ("0" + code.toString(16)).slice(-2).toUpperCase() : "";
    });
    var q = win ? '"' : "'";
    file_remove(out_file);
    var cmd = CURL_CMD + " -s -S -L -f --max-redirs 5 --max-time 30 --compressed" +
              " -A " + q + USER_AGENT + q +
              " -H " + q + "Accept-Language: en-US,en;q=0.9" + q +
              " -o " + q + out_file + q +
              " " + q + safe_url + q;
    var rc = system.exec(cmd);
    if (rc !== 0) {
        log(LOG_WARNING, "curl returned " + rc + " for " + url);
        return null;
    }
    var f = new File(out_file);
    if (!f.open("rb"))
        return null;
    var body = f.read();
    f.close();
    return body && body.length ? body : null;
}

/*
 * Downloads a web page with a fresh HTTPRequest (and therefore a fresh
 * TLS session) per attempt, retrying a few times on failure. Many news
 * CDNs drop or reset connections that look like bots - Synchronet's
 * default "SYNXv0.1" User-Agent and "Via:" header are an easy tell - so
 * this sends a browser-style request, follows redirects, and refuses to
 * treat HTTP error pages as article text.
 */
function fetchPage(url, curl_out_file) {
    var last_err = "unknown error";
    if (USE_CURL) {
        var page = fetchPageCurl(url, curl_out_file);
        if (page)
            return page;
        log(LOG_WARNING, "curl download failed for " + url + "; falling back to built-in HTTP client");
    }
    for (var attempt = 1; attempt <= FETCH_ATTEMPTS && bbs.online; attempt++) {
        var req = new HTTPRequest(undefined, undefined, { "Accept-Language": "en-US,en;q=0.9" });
        req.user_agent = USER_AGENT;
        req.follow_redirects = 5;
        req.AddDefaultHeaders = function () {   // same as http.js's, minus "Via:" and the odd Accept-Charset
            this.request_headers.push("Connection: close");
            this.request_headers.push("Accept: text/html,application/xhtml+xml,*/*;q=0.8");
            this.request_headers.push("Accept-Encoding: ");
            this.request_headers.push("Host: " + this.url.host);
            if (this.referer != undefined)
                this.request_headers.push("Referer: " + this.referer);
            this.request_headers.push("User-Agent: " + this.user_agent);
        };
        try {
            var body = req.Get(url);
            if (req.response_code >= 200 && req.response_code < 300 && body)
                return body;
            last_err = "HTTP status " + req.response_code;
        } catch (e) {
            last_err = e;
        } finally {
            try { if (req.sock) req.sock.close(); } catch (ce) { }
        }
        log(LOG_WARNING, "Attempt " + attempt + " of " + FETCH_ATTEMPTS + " failed for " + url + ": " + last_err);
        if (attempt < FETCH_ATTEMPTS)
            mswait(1000 * attempt);
    }
    throw new Error(last_err);
}

function getFullArticle(article_url, article_title) {
    const TEMP_NEWS_HTML_RAW = backslash(TEMP_PATH) + "temp-news-raw.html";
    print("\x01n\x01gGetting article from:\r\n\x01n\x01c" + article_url + "\x01n...\r\n");
    try {
        var resp = fetchPage(article_url, TEMP_NEWS_HTML_RAW);
        if (!USE_CURL || !file_exists(TEMP_NEWS_HTML_RAW)) {   // keep a copy of the raw page for debugging
            var fhtml = new File(TEMP_NEWS_HTML_RAW);
            if (fhtml.open("wb", false)) {
                fhtml.write(resp);
                fhtml.close();
            } else {
                log(LOG_WARNING, "Couldn't open temp file for writing: " + TEMP_NEWS_HTML_RAW);
            }
        }

        displayText("\x01q\x01l" +
            utf8_decode(html2asc(scrapeArticleText(resp), BW_TEXT))  // convert the extracted content to ascii
                .replace(/\[(.|\n|\r)*?\]/g, "")  // strip out text between [] brackets, usually embedded urls, etc.
                .replace(/\r/g, "")
                .replace(/\n\n/g, "\x01n\n\n"),   // correct for colors that don't cancel
            article_title);
    } catch (err) {
        print("\x01nFailed... \x01hPlease try again later.\x01n");
        log(LOG_WARNING, "No response from: " + article_url + "; err: " + err);
    }
}

function showArticle(title, author, date, body, full_article_prompt, article_url) {
    console.clear();
    print("\x01n\x01bTitle:  \x01w\x01h" + lfexpand(word_wrap(title, WIDTH-10, WIDTH-10, true, true)).replace(/\r\n/g, "\r\n        ").trim());
    if (author) {
        printf("\x01n\x01bAuthor: \x01w\x01h%s\r\n", html2asc(author, BW_TEXT).trim());
    }
    print("\x01n\x01bDate:   \x01w\x01h" + (new Date(date)).toLocaleString());
    print(DIVIDER);
    if (body.search(/<\/?[a-z][\s\S]*>/i) >= 0) { // only convert html to ascii
        body = html2asc(body, BW_TEXT, true);     // if there's html in the body
    }
    print(lfexpand(word_wrap(utf8_decode(body), WIDTH-1, WIDTH-1, true, true)));

    if (full_article_prompt) {
        if (!console.noyes("Read full article text")) {
            getFullArticle(article_url, title);
        }
    } else {
        print("\x01n\x01b\x01h/===END===/");
        console.pause();
    }
}

function feedMenu(feedsource) {
    var msgFile = "";
    var selection = 0;
    var last_selected;
    var startY;
    var rss;
    var retries = 0;
    var max_retries = 5;
    var last_err = "";
    printf("\x01L\x01nGetting feed for \x01h%s\x01n...", feedsource.name);
    while (retries < max_retries && rss === undefined) {
        try {
            rss = new Feed(feedsource.url, true, backslash(TEMP_PATH) + "temp-feed.rss").channels[0]; // It's normal to have at most one channel in a feed.
        } catch (f_err) {
            retries++;
            last_err = f_err;
            log(LOG_WARNING, f_err + " ... " + feedsource.name + " (url: " + feedsource.url + "). Attempt " + retries + " of " + max_retries);
            mswait(500);
        }
    }
    if (rss === undefined) {
        print("\x01n\r\n\r\nCouldn't get any data from " + feedsource.name + "\x01n, \x01hsorry!.\x01n");
        print("Error: " + last_err);
        return "BAD";
    }

    while (bbs.online && selection !== "Q") {
        selection = "";
        msgFile = backslash(EXEC_PATH + "gfx") + feedsource.icon + ".msg";
        console.clear();
        if (file_exists(msgFile)) {
            console.printfile(msgFile, P_NOABORT);
            startY = console.getxy().y;
        } else {
            log(LOG_WARNING, "Missing msg header file: " + msgFile);
            startY = 5;
        }
        console.gotoxy(30, 1);
        printf("\x01y\x01h%*s", WIDTH-30, rss.title.slice(0, WIDTH-31).trim());
        console.gotoxy(30, 2);
        printf("\x01w\x01h%*s", WIDTH-30, "updated " + system.timestr(new Date(rss.updated ? rss.updated : rss.items[0].date).getTime() / 1000));

        var frame = new Frame(31, 3, 49, 5, BG_BLACK);
        frame.open();
        frame.putmsg("\x01k\x01h" + lfexpand(word_wrap(utf8_decode(rss.description.trim()), 49, 49, true, true)).trim());
        frame.cycle();

        console.gotoxy(1, startY);
        print("\x01n\r\n" + format(WIDTH >= 132 ? "\x01c%2s\x01k\x01h)\x01n \x01w%-110s\x01n \x01b%-8s" : "\x01c%2s\x01k\x01h)\x01n \x01w%-65s\x01n \x01b%-8s", "#", "title", "added"));
        print(DIVIDER);

        console.gotoxy(1, console.screen_rows-1);
        console.center("\x01w\x01hQ\x01k\x01\h) \x01w\x01hQ\x01nuit to Feed Menu");
        var lbArticleMenu = new DDLightbarMenu(1, startY+3, WIDTH-1, HEIGHT - (startY+5));
        for (var i = 0; i < rss.items.length; i++) {
            lbArticleMenu.Add(format(WIDTH >= 132 ? "\x01c\x01h%2d\x01k\x01h)\x01n \x01w\x01h%-110.110s\x01n \x01b\x01h%-8.8s" : "\x01c\x01h%2d\x01k\x01h)\x01n \x01w\x01h%-65.65s\x01n \x01b\x01h%-8.8s",
                                     i+1,
                                     utf8_decode(rss.items[i].title).replace(/[^a-zA-Z0-9 \-,.'":!\@#$%\^&\*\(\)\[\]]/g, ""),
                                     system.datestr(new Date(rss.items[i].date).getTime() / 1000) ), i+1 );
        }
        lbArticleMenu.AddAdditionalQuitKeys("qQ");
        lbArticleMenu.colors.itemColor = "\x01k\x01h";
        lbArticleMenu.colors.selectedItemColor = "\x01w\x01h\x01" + "4";
        lbArticleMenu.scrollbarEnabled = true;
        lbArticleMenu.ampersandHotkeysInItems = false;
        if (last_selected !== undefined && last_selected !== "" ) {
            lbArticleMenu.SetSelectedItemIdx(last_selected);
        }
        selection = lbArticleMenu.GetVal();

        if (!selection) { 
            selection = "Q";
        }
        if (!isNaN(selection)) {
            selection = parseInt(selection) - 1;
            last_selected = selection;
            if (feedsource.description_is_full_article) {
                displayText("\x01q\x01l" + utf8_decode(html2asc((rss.items[selection].body ?
                                     rss.items[selection].body :
                                     rss.items[selection].content), BW_TEXT)) 
                        .replace(/\r/g, "")
                    , utf8_decode(rss.items[selection].title));
            } else {
                showArticle(utf8_decode(rss.items[selection].title),
                            rss.items[selection].author,
                            rss.items[selection].date,
                            (rss.items[selection].body ?
                             rss.items[selection].body :
                             rss.items[selection].content),
                            feedsource.full_article_prompt,
                            rss.items[selection].link);
            }
        }
        frame.close();
    }
    return "OK";
}

function mainMenu() {
    var func_exit = false;
    var selection = "";
    var last_selected;
    var jSources = "";
    var fSources = new File(backslash(EXEC_PATH) + "newsfeeds.json");
    if (!file_isdir(TEMP_PATH)) {
        mkdir(TEMP_PATH);
    }
    if (fSources.open("r")) {
        jSources = JSON.parse(fSources.read());
        fSources.close();
        while (bbs.online && !js.terminated && !func_exit) {
            console.clear();
            console.printfile(backslash(EXEC_PATH + "gfx") + HDR_FILE, P_NOABORT);

            console.gotoxy(1, console.screen_rows-1);
            console.center("\x01w\x01hQ\x01k\x01\h) \x01w\x01hQ\x01nuit");

            var lbMenu = new DDLightbarMenu(17, 10, WIDTH - 33, HEIGHT - 12);
            for (var s = 0; s < Object.keys(jSources).length; s++) {
                lbMenu.Add(jSources[s].name + ( jSources[s].status ? ( (jSources[s].status==="BAD" ? " [!]" : "" )) : "" ), s+1 );
            }
            console.gotoxy(1, 9);
            console.center("\x01nUse \x01w\x01h" + ascii(24) + " \x01nand \x01w\x01h" + ascii(25) +" \x01nkeys to scroll, \x01w\x01hENTER \x01nselects");
            lbMenu.colors.itemColor = "\x01k\x01h";
            lbMenu.colors.selectedItemColor = "\x01w\x01h\x01" + "4";
            lbMenu.AddAdditionalQuitKeys("qQ");
            lbMenu.borderEnabled = true;
            lbMenu.scrollbarEnabled = true;
            if (last_selected) {
                lbMenu.SetSelectedItemIdx(last_selected);
            }
            selection = lbMenu.GetVal();

            if (!selection) { 
                func_exit = true;
            } else if (!isNaN(selection)) {
                selection = parseInt(selection) - 1;
                last_selected = selection;
                var result = feedMenu(jSources[selection]);
                jSources[selection].status = result;
                jSources[selection].last_used = system.timestr(new Date().getTime() / 1000);
                var fSourcesEdit = new File(EXEC_PATH + "newsfeeds.json");
                if (fSourcesEdit.open("w")) {
                    fSourcesEdit.write(JSON.stringify(jSources, undefined, 2));
                    fSourcesEdit.close();
                }
            }
        }
    }
}

mainMenu();