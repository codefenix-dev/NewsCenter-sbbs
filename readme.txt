NewsCenter
version 0.261026 

by Craig Hendricks  
codefenix@conchaos.synchro.net

ConstructiveChaos BBS:
codefenix@conchaos.synchro.net  
 telnet://conchaos.synchro.net  
  https://conchaos.synchro.net  



Description:

  A news RSS feed viewer for Synchronet BBS, which lets users read the
  article text in the BBS terminal.
  
  
  
NewsDesk has died. Long live NewsCenter!
  
  This is the successor to the old "NewsDesk" mod. The simple, limited, 
  key-driven menu has been ditched in favor of a completely lightbar-driven
  interface. It lets the sysop configure as many different feeds desired,
  with no limit to the number of articles that can be viewed.
  
  If you're coming from the old NewsDesk mod, this will require a fresh
  install. Your old news_src.json from the news.js script won't work with
  this.
  


How it works:

  It makes use of a customized version of Synchronet's rss-atom.js library,
  named rss-curl.js to fetch RSS feeds.

  It also makes use of Digital Distortion Lightbar Menu Library, so ensure 
  dd_lightbar_menu.js exists in the /sbbs/exec/load directory, and it is 
  up to date.

  When a user selects an article to view, they can optionally be given the 
  choice to read the full text of the article, which NewsCenter downloads
  directly from the source website and extracts itself.
  
  It can be used in both 80 column and 132 column modes, spanning to all 
  available rows and columns.



Instructions:

 1. Extract the contents of the ZIP file to /sbbs/xtrn/newscenter
 
 2. Add to SCFG -> External Programs-> Online Programs (Doors):

    Name                     NewsCenter
    Internal Code            NEWSCENTER
    Start-up Directory       ../xtrn/newscenter
    Command Line             ?newscenter.js
    Execution Requirements   ANSI
    Execute on Event         Logon    <--Optional   

    If you want to show news during logon, you can set "Execute on Event"
    to "Logon", but be sure to answer "No" to the "Execute on Event Only"
    prompt that follows, otherwise users won't be able to select it from
    the External Programs menu.
    
    If you want to add an option to a command shell menu, you can 
    modify your command shell script with something similar to this.
    
    'N': { eval: 'bbs.exec("?../xtrn/newscenter/newscenter.js")' },
    
    This is assuming you're using the newer JavaScript command shell style.
 


Configuration and Customization:

  Edit the included .msg files to your liking in PabloDraw.

  Many news sources come preconfigured. You can add or remove news sources to 
  your liking in the `newsfeeds.json` file. Each entry should be formatted as 
  follows:

  {
    "name": "BBC News",
    "url": "http://feeds.bbci.co.uk/news/rss.xml",
    "icon": "bbc",
    "full_article_prompt": true
  },

  The file must be valid JSON, or the script will not load.

  The `icon` should correspond to a .msg file in the `gfx` directory.

  Setting `full_article_prompt` to true will prompt the user to view the full 
  article text. Set this to false if there's enough info given in the RSS feed 
  itself, or if the results are not readable.

  If the "body" or "content" within the RSS feed contains enough text to not need
  to retrieve the article, then you can set `description_is_full_article` to true.
  Use your own judgement on this setting.



Usage:

  NewsCenter is completely lightbar driven. The user navigates the feed list 
  and article listings with the arrow keys, and presses Enter to make a
  selection.
  
  For feeds with "full_article_prompt" enabled, the user will be given the 
  option to view the full article from the source. The article's HTML page
  is downloaded directly from the source site. The article text is taken from
  the page's embedded schema.org (JSON-LD) data when available; otherwise
  the script locates the main content block of the page and discards
  navigation, ads, and other clutter. The result is converted to a plain text
  file with CTRL-A codes which Synchronet can show in the terminal.
  
  No third-party service is used. Results vary by site; paywalled or heavily
  script-rendered pages may yield little or no text.
  
  If Scroller is present on the system in /sbbs/xtrn/scroller, then it will 
  be used to view the resulting article text file. Otherwise, the file is 
  shown using Synchronet's standard text output with screen pauses.
  
  The status and date/time that each feed is last used gets saved to the JSON
  file with each use. If there are no errors while retrieving the RSS feed, 
  the status is "OK", otherwise the status is "BAD" and the feed name gets
  an exclamation point [!] next to it in the lightbar menu. This status 
  indicator is intended to help users and sysops keep track of which feeds are
  good or bad at a glance at any time. The last_used date/time can serve as 
  an indication for the sysop as to which feeds are popular and which ones
  aren't.
  


Thanks & Greetz:
    
  Huge thanks to Nightfox of Digital Distortion BBS for creating and 
  maintaining the awesome DDLightbarMenu library for Synchronet.
    - www.digitaldistortionbbs.com



Version History:

v 0.261026 - October 26, 2026:

  + Fixed a RegEx issue that caused slashes (/) to not show up in the article
    lists.

v 0.261002 - October 2, 2026:

  + RSS Feeds as well as article pages are now fetched primarily using curl 
    requests instead of Synchronet's built-in HTTPRequest library.
  + Removed FrogFind dependency. Article text is scraped from the downloaded
    article's webpage HMTL.

v 0.250415 - April 15, 2025:

  + Fixed an issue that caused dashes (-) to not show up in the article
    lists.

v 0.250413 - April 13, 2025:

  + Fixed an issue that would cause the .msg header files to not
    display after viewing an article in Scroller.
   
   
v 0.250410 - April 10 2025:

  + Initial version.
