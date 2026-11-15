import asyncio
import base64
import logging
import os
import re
import time
import functools
import urllib.parse
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from collections import defaultdict

import httpx
import requests
import yt_dlp
from quart import Quart, request, jsonify, Response
from quart_cors import cors
from ytmusicapi import YTMusic
from yt_dlp import YoutubeDL
from yt_dlp.extractor.youtube import YoutubeIE, YoutubeTabIE
from yt_dlp.extractor.youtube._base import _PoTokenContext, _split_innertube_client, PlayerPoTokenPolicy
from yt_dlp.utils import (
    get_first, int_or_none, parse_duration, remove_end, 
    remove_start, str_or_none, traverse_obj, update_url_query
)

# --- קבועים ומשתנים גלובליים ---
XOR_KEY = 0x77
XOR_TABLE = bytes([b ^ XOR_KEY for b in range(256)])
ENCRYPTION_KEY = b"efitoyb"
D_CLIENT = 'web_embedded'
AUDIO_URL_CACHE = {}
YTCFG_CACHE = {}
AUDIO_URL_TTL = 30 * 60  # 30 דקות
SEARCH_CACHE = {}
GLOBAL_YTCFG = None
LAST_YTCFG_UPDATE = 0
PADDING_SIZE = 128 * 1024  # 128KB
PADDING_BYTES = PADDING_SIZE.to_bytes(4, byteorder='big') + b'free' + b'\x00' * (PADDING_SIZE - 8)
DEFAULT_COOKIES_FILE = "cookies.txt"

# קבועי yt-dlp
STREAMING_DATA_CLIENT_NAME = '__yt_dlp_client'
STREAMING_DATA_FETCH_SUBS_PO_TOKEN = '__yt_dlp_fetch_subs_po_token'
STREAMING_DATA_FETCH_GVS_PO_TOKEN = '__yt_dlp_fetch_gvs_po_token'
STREAMING_DATA_PLAYER_TOKEN_PROVIDED = '__yt_dlp_player_token_provided'
STREAMING_DATA_INNERTUBE_CONTEXT = '__yt_dlp_innertube_context'
STREAMING_DATA_IS_PREMIUM_SUBSCRIBER = '__yt_dlp_is_premium_subscriber'
STREAMING_DATA_AVAILABLE_AT_TIMESTAMP = '__yt_dlp_available_at_timestamp'

# --- אתחול האפליקציה ---
app = Quart(__name__)
app = cors(app, allow_origin="*")
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

ytmusic = YTMusic()

cache_lock = asyncio.Lock()

async def cleanup_expired_cache():
    current_time = time.time()
    async with cache_lock:
        # ניקוי מטמון כתובות שמע
        expired_audio = [vid for vid, data in AUDIO_URL_CACHE.items()
                         if current_time - data.get('timestamp', 0) > AUDIO_URL_TTL]
        for vid in expired_audio:
            del AUDIO_URL_CACHE[vid]

        # ניקוי YTCFG וחיפושים
        expired_searches = [sid for sid, data in SEARCH_CACHE.items()
                            if current_time - data.get('timestamp', 0) > AUDIO_URL_TTL]
        for sid in expired_searches:
            del SEARCH_CACHE[sid]

        expired_ytcfg = [vid for vid, data in YTCFG_CACHE.items()
                         if current_time - data.get('timestamp', 0) > AUDIO_URL_TTL]
        for vid in expired_ytcfg:
            del YTCFG_CACHE[vid]

# --- פונקציות עזר ---
def xor_bytes(buf: bytes, key: bytes) -> bytes:
    lk = len(key)
    return bytes(b ^ key[i % lk] for i, b in enumerate(buf))

def encrypt_text(text: str) -> str:
    if not text: return ""
    encrypted_bytes = xor_bytes(text.encode('utf-8'), ENCRYPTION_KEY)
    return base64.b64encode(encrypted_bytes).decode('utf-8')

def decrypt_text(b64_text: str) -> str:
    if not b64_text: return ""
    try:
        encrypted_bytes = base64.b64decode(b64_text)
        decrypted_bytes = xor_bytes(encrypted_bytes, ENCRYPTION_KEY)
        return decrypted_bytes.decode('utf-8')
    except Exception:
        return b64_text

def is_encryption_requested(default_encrypted: bool = False) -> bool:
    enc_arg = request.args.get('enc')
    if enc_arg is not None:
        return str(enc_arg).lower() not in ['0', 'false', 'off', 'no']
    underscore_arg = request.args.get('use_underscore')
    if underscore_arg is not None:
        return str(underscore_arg).lower() in ['1', 'true', 'on', 'yes']
    return default_encrypted

def encrypt_results_list(results_list: list) -> list:
    if not results_list:
        return []
    encrypted_out = []
    for item in results_list:
        if not isinstance(item, dict):
            encrypted_out.append(item)
            continue
        copied = dict(item)
        for field in ['title', 'author', 'channel', 'thumbnail', 'thumbnail_url']:
            if copied.get(field) and isinstance(copied[field], str):
                copied[field] = encrypt_text(copied[field])
        encrypted_out.append(copied)
    return encrypted_out

# --- משתנים ומחלקות עזר לחיפוש שלך ---
API_KEYS = [
    "AIzaSyBHL_NpCJkUuij2SRf4OV-YwOqGinZ1tME",
    "AIzaSyBpPQj36a649t0AOkIHZWKk1i8Ot-ui0YI",
    "AIzaSyBwlkY7v2XZ165R9R1Q_cEAYxGHK5itHTQ",
    "AIzaSyBkagzG6LSHjzD5MCtIXI3XOtNG5YI0Vac",
    "AIzaSyDkDqaebmUkIocmt12U4uFCXvmdy5TRZE8",
    "AIzaSyAjRamGvGy9n1p_Z8TOy9aZy5lDljDDJ60"
]
current_key_index = 0

class YTDLPLogger(object):
    def debug(self, msg): pass
    def warning(self, msg): pass
    def error(self, msg): logging.error(msg)

def parse_iso8601_duration(duration_str):
    # פונקציית עזר להמרת זמן (PT#M#S) לשניות עבור החיפוש של גוגל
    match = re.match(r'PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?', str(duration_str))
    if not match: return 0
    hours = int(match.group(1) or 0)
    minutes = int(match.group(2) or 0)
    seconds = int(match.group(3) or 0)
    return hours * 3600 + minutes * 60 + seconds


# =========================================================================
# פונקציית החיפוש המקורית שלך - מועתקת בשלמותה!
# =========================================================================
async def search_youtube(query: str, max_results: int = 200, search_engine: str = 'youtube', region_code: str = 'IL'):
    global current_key_index
    try:
        if search_engine.startswith('youtubemusic'):
            try:
                # Handle playlist URL directly first
                playlist_match = re.search(r'list=([a-zA-Z0-9_-]+)', query)
                if playlist_match:
                    playlist_id = playlist_match.group(1)
                    playlist = await asyncio.to_thread(ytmusic.get_playlist, playlist_id, limit=500)
                    results = []
                    for track in playlist.get('tracks', []):
                        results.append({
                            "type": "song",
                            "id": track.get("videoId"),
                            "title": track.get("title"),
                            "url": f"https://www.youtube.com/watch?v={track.get('videoId')}",
                            "duration": track.get("duration_seconds", 0),
                            "author": ", ".join([artist.get('name', '') for artist in track.get('artists', []) if artist]),
                            "thumbnail_url": track.get("thumbnails", [{}])[-1].get("url")
                        })
                    return {"success": True, "results": results, "isPlaylistUrlResult": True, "playlistTitle": playlist.get('title')}

                # If not a playlist URL, perform search based on type
                # --- תיקון לוגיקת הפילטרים ---
                results = []
                search_filter = None
                limit = 100 # הגדלת הגבלה לתוצאות מעורבבות

                if search_engine == 'youtubemusic_all':
                    search_filter = None  # חשוב: None מביא תוצאות מעורבבות (הכל)
                elif search_engine == 'youtubemusic_songs':
                    search_filter = 'songs'
                elif search_engine == 'youtubemusic_playlists':
                    search_filter = 'playlists'
                elif search_engine == 'youtubemusic_artists':
                    search_filter = 'artists'
                elif search_engine == 'youtubemusic_albums':
                    search_filter = 'albums'
                elif search_engine == 'youtubemusic_podcasts':
                    search_filter = 'podcasts'
                else:
                    return {"success": False, "error": "Invalid youtube music search type"}

                search_results_ytm = await asyncio.to_thread(lambda: ytmusic.search(query, filter=search_filter, limit=limit) or [])

                for item in search_results_ytm:
                    res_type = item.get('resultType')
                    
                    # === התיקון המלא שחובה להעתיק - כולל ה-else! ===
                    if not res_type:
                        if search_filter:
                            type_mapping = {'songs': 'song', 'albums': 'album', 'artists': 'artist', 'playlists': 'playlist', 'podcasts': 'podcast'}
                            res_type = type_mapping.get(search_filter)
                        else:
                            # הפולבאק הקריטי שחסר לך שמציל את האלבומים והאמנים בטאב "הכל"
                            if item.get('videoId'):
                                res_type = 'song'
                            elif item.get('browseId'):
                                if item.get('itemCount') is not None or 'playlist' in str(item.get('browseId')).lower():
                                    res_type = 'playlist'
                                elif item.get('artist'):
                                    res_type = 'artist'
                                else:
                                    res_type = 'album'
                    # ==========================================================

                    if res_type in ['song', 'video']:
                        results.append({
                            "type": "song",
                            "id": item.get("videoId"),
                            "title": item.get("title"),
                            "url": f"https://www.youtube.com/watch?v={item.get('videoId')}",
                            "duration": item.get("duration_seconds", 0),
                            "author": ", ".join([artist.get('name', '') for artist in item.get('artists', []) if artist]),
                            "thumbnail_url": item.get("thumbnails", [{}])[-1].get("url")
                        })
                    elif res_type == 'playlist':
                        results.append({
                            "type": "playlist",
                            "id": item.get("browseId"),
                            "playlistId": item.get("browseId"),
                            "title": item.get("title"),
                            "author": item.get("author"),
                            "itemCount": item.get("itemCount"),
                            "thumbnail_url": item.get("thumbnails", [{}])[-1].get("url")
                        })
                    elif res_type == 'artist':
                        results.append({
                            "type": "artist",
                            "id": item.get("browseId"),
                            "title": item.get("artist"),
                            "url": f"https://music.youtube.com/channel/{item.get('browseId')}",
                            "thumbnail_url": item.get("thumbnails", [{}])[-1].get("url")
                        })
                    elif res_type == 'album':
                        results.append({
                            "type": "album",
                            "id": item.get("browseId"),
                            "title": item.get("title"),
                            "url": f"https://music.youtube.com/browse/{item.get('browseId')}",
                            "author": ", ".join([artist.get('name', '') for artist in item.get('artists', []) if artist]),
                            "itemCount": item.get("year"), # Use itemCount to store the year
                            "thumbnail_url": item.get("thumbnails", [{}])[-1].get("url")
                        })
                    elif res_type == 'podcast':
                        results.append({
                            "type": "podcast",
                            "id": item.get("browseId"),
                            "title": item.get("title"),
                            "url": f"https://music.youtube.com/browse/{item.get('browseId')}",
                            "author": item.get("author"),
                            "thumbnail_url": item.get("thumbnails", [{}])[-1].get("url")
                        })
                
                return {"success": True, "results": results}
            except Exception as e:
                logging.error(f"❌ YouTube Music search error: {str(e)}", exc_info=True)
                return {"success": False, "error": f"YouTube Music search failed: {str(e)}"}
        elif search_engine == 'google':
            published_after = (datetime.now(ZoneInfo("UTC")) - timedelta(days=30)).strftime('%Y-%m-%dT%H:%M:%SZ')
            
            while True:
                key = API_KEYS[current_key_index]
                url = (
                    f"https://www.googleapis.com/youtube/v3/search"
                    f"?part=snippet&type=video&maxResults={max_results}"
                    f"&q={query}&key={key}"
                    f"&regionCode={region_code or 'IL'}"  
                    f"&relevanceLanguage=he"  
                    f"&publishedAfter={published_after}"  
                )
                
                async with httpx.AsyncClient() as client:
                    resp = await client.get(url)
                    data = resp.json()
                    
                    if resp.status_code == 403 and "quotaExceeded" in str(data):
                        current_key_index = (current_key_index + 1) % len(API_KEYS)
                        continue
                    
                    search_results = []
                    video_ids = []
                    for item in data.get("items", []):
                        snippet = item["snippet"]
                        video_id = item["id"]["videoId"]
                        video_ids.append(video_id)
                        search_results.append({
                            "type": "song",
                            "id": video_id,
                            "title": snippet["title"],
                            "url": f"https://www.youtube.com/watch?v={video_id}",
                            "duration": "N/A",  # Placeholder
                            "channel": snippet["channelTitle"],
                            "thumbnail_url": snippet["thumbnails"]["high"]["url"]
                        })

                    if not video_ids:
                        return {"success": True, "results": []}

                    video_details = {}
                    id_batches = [video_ids[i:i + 50] for i in range(0, len(video_ids), 50)]

                    for batch in id_batches:
                        ids_str = ",".join(batch)
                        
                        while True:
                            key = API_KEYS[current_key_index]
                            details_url = (
                                f"https://www.googleapis.com/youtube/v3/videos"
                                f"?part=contentDetails&id={ids_str}&key={key}"
                            )
                            async with httpx.AsyncClient() as client:
                                details_resp = await client.get(details_url)
                                details_data = details_resp.json()

                            if details_resp.status_code == 403 and "quotaExceeded" in str(details_data):
                                current_key_index = (current_key_index + 1) % len(API_KEYS)
                                continue
                            
                            break
                        
                        if "items" in details_data:
                            for item in details_data["items"]:
                                duration_iso = item.get("contentDetails", {}).get("duration")
                                if duration_iso:
                                    video_details[item["id"]] = parse_iso8601_duration(duration_iso)

                    for res in search_results:
                        res['duration'] = video_details.get(res['id'], "N/A")
                    
                    return {"success": True, "results": search_results}
        else:
            ydl_opts = {'dump_single_json': True, 'quiet': False, 'verbose': True, 'logger': YTDLPLogger(), 'extract_flat': True}
            search_query = f"ytsearch{max_results}:{query}"
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = await asyncio.to_thread(lambda: ydl.extract_info(search_query, download=False))

            if not info or 'entries' not in info:
                return {"success": False, "error": "No search results found."}

            results = []
            
            # --- Start: Channel Detection Logic ---
            top_results_for_channel_check = info['entries'][:5]
            if len(top_results_for_channel_check) > 1:
                channel_counts = defaultdict(int)
                channel_info_map = {}
                for item in top_results_for_channel_check:
                    if item.get('channel_id'):
                        cid = item['channel_id']
                        channel_counts[cid] += 1
                        if cid not in channel_info_map:
                            channel_info_map[cid] = {'name': item.get('channel'), 'videos': []}
                        channel_info_map[cid]['videos'].append(item)
                
                if channel_counts:
                    most_frequent_cid = max(channel_counts, key=channel_counts.get)
                    if channel_counts[most_frequent_cid] >= 2:
                        c_info = channel_info_map[most_frequent_cid]
                        c_name = c_info.get('name')
                        
                        query_lower = query.lower()
                        name_match = c_name and (query_lower in c_name.lower() or c_name.lower() in query_lower)
                        
                        title_match = False
                        for video in c_info.get('videos', []):
                            video_title = video.get('title', '').lower()
                            if query_lower in video_title:
                                title_match = True
                                break
                        
                        if c_name and (name_match or title_match):
                            channel_result = {
                                "type": "channel",
                                "id": most_frequent_cid,
                                "channelId": most_frequent_cid,
                                "title": f"הערוץ הרשמי: {c_name}",
                                "description": "לחץ כדי לראות את כל הסרטונים מהערוץ",
                                "author": c_name,
                                "duration": "N/A",
                                "thumbnail_url": None,
                            }
                            results.append(channel_result)
            # --- End: Channel Detection Logic ---
            
            async with httpx.AsyncClient() as client:
                for item in info['entries']:
                    thumbnails = item.get("thumbnails")
                    thumb_url = thumbnails[-1].get("url") if thumbnails else ""
                    results.append({
                        "type": "song",
                        "id": item.get("id"),
                        "title": item.get("title"),
                        "url": item.get("webpage_url"),
                        "duration": item.get("duration", "N/A"),
                        "channel": item.get("channel", "N/A"),
                        "thumbnail_url": thumb_url
                    })
            return {"success": True, "results": results}

    except Exception as e:
        return {"success": False, "error": str(e)}

# --- ראוטים ---


# =========================================================================
# המחלקה המלאה מה-TEST.PY שלך - מועתקת בשלמותה ללא שינוי או מחיקה!
# =========================================================================
class FeedExtractor:
    def __init__(self, url, cookies='cookies.txt'):
        self.url = url
        self.video_id = YoutubeIE()._match_id(url) # חילוץ ה-ID כבר בהתחלה
        
        ydl_opts = {
            'cookiefile': cookies if os.path.exists(cookies) else None, 
            'extractor_args': {
                'youtubetab': {'skip': ['authcheck']},
                'youtube': {'player_client': [D_CLIENT]}
            },            
            'quiet': True,
            'no_warnings': True,
        }
        
        self.ydl = YoutubeDL(ydl_opts)
        self.ie = YoutubeIE(self.ydl) # חשוב: העברת ה-downloader הקיים
        self.ie_tab = YoutubeTabIE(self.ydl)
        
        # טעינה מה-Cache אם קיים
        self.ytcfg = YTCFG_CACHE.get(self.video_id)
        self.data = None
        self.item_id = self.video_id
    
    def init1(self):
        self.data, self.ytcfg = self.ie._extract_data(self.url, self.item_id, self.ytcfg,default_client = D_CLIENT)
        self.visitor_data = self.ie._extract_visitor_data(self.data, self.ytcfg)
        self.delegated_session_id = self.ie._extract_delegated_session_id(self.ytcfg, self.data)

    def get_video_page_data(self):
        info = {}
        contents = traverse_obj(self.data, ('contents', 'twoColumnWatchNextResults', 'results', 'results', 'contents', ...), default=[])
        primary_info = secondary_info = comment_section = None
        for section in contents:
            if section.get('videoPrimaryInfoRenderer'):
                primary_info = section.get('videoPrimaryInfoRenderer')
            elif section.get('videoSecondaryInfoRenderer'):
                secondary_info = section.get('videoSecondaryInfoRenderer')
            elif section.get('itemSectionRenderer'):
                if section['itemSectionRenderer'].get('header'):
                    comment_section = section.get('itemSectionRenderer')
                    break
        like_path = ['videoActions', 'menuRenderer', 'topLevelButtons', ..., 'segmentedLikeDislikeButtonViewModel', 'likeButtonViewModel', 'likeButtonViewModel', 'toggleButtonViewModel', 'toggleButtonViewModel', 'defaultButtonViewModel', 'buttonViewModel', 'title']
        like_bool_path = ['videoActions', 'menuRenderer', 'topLevelButtons', ..., 'segmentedLikeDislikeButtonViewModel', 'likeButtonViewModel', 'likeButtonViewModel', 'likeStatusEntity', 'likeStatus']
        info['title'] = traverse_obj(primary_info, ('title', 'runs', 0, 'text'), default='')
        info['view_count'] = traverse_obj(primary_info, ('viewCount', 'videoViewCountRenderer', 'viewCount', 'simpleText'), default='')
        info['short_view_count'] = traverse_obj(primary_info, ('viewCount', 'videoViewCountRenderer', 'shortViewCount', 'simpleText'), default='')
        hashtag_list = []
        hashtags = traverse_obj(primary_info, ('superTitleLink', 'runs', ...), default=[])
        for hashtag in hashtags:
            if hashtag.get('text').startswith('#'):
                hashtag_list.append(hashtag.get('text'))
        info['hashtags'] = hashtag_list
        info['date'] = traverse_obj(primary_info, ('dateText', 'simpleText'), default='')
        info['relative_date'] = traverse_obj(primary_info, ('relativeDateText', 'simpleText'), default='')
        info['like_count'] = traverse_obj(primary_info,like_path, default='',get_all=False)
        info['is_liked'] = traverse_obj(primary_info, like_bool_path, default=False, get_all=False) == 'LIKE'
        info['channel_name'] = traverse_obj(secondary_info, ('owner','videoOwnerRenderer', 'title', 'runs', 0, 'text'), default='')
        info['channel_id'] = traverse_obj(secondary_info, ('owner','videoOwnerRenderer',  'navigationEndpoint', 'browseEndpoint', 'browseId'), default='')
        info['channel_thumbnails'] = traverse_obj(secondary_info, ('owner','videoOwnerRenderer', 'thumbnail', 'thumbnails'), default=[])
        info['channel_subs_count'] = traverse_obj(secondary_info, ('owner','videoOwnerRenderer',  'subscriberCountText', 'simpleText'), default='')
        info['channel_is_subscriber'] = traverse_obj(secondary_info, ('subscribeButton','subscribeButtonRenderer',  'subscribed'), default=False)
        info['comment_token'] = traverse_obj(comment_section,('contents', 0, 'continuationItemRenderer', 'continuationEndpoint', 'continuationCommand', 'token'))
        info['description'] = traverse_obj(secondary_info,('attributedDescription','content'),default = '')
        description_links = traverse_obj(secondary_info,('attributedDescription', 'commandRuns'),default= [])
        info['description_links'] = []
        for link in description_links:
            link_enrty = {}
            link_enrty["start_index"] = link.get('startIndex')
            link_enrty['length'] = link.get('length')
            if link.get('onTapOptions'):
                link_enrty['type'] = 'seek'
                link_enrty['time'] = traverse_obj(link,('onTap', 'innertubeCommand', 'watchEndpoint','startTimeSeconds'),default = 0)
            else:
                if traverse_obj(link,('onTap','innertubeCommand','browseEndpoint') ,default=None):
                    link_enrty['type'] = 'inline_link'
                else:
                    link_enrty['type'] = 'link'
                link_enrty['url'] = traverse_obj(link,('onTap', 'innertubeCommand', 'commandMetadata', 'webCommandMetadata', 'url'),default='')
            info['description_links'].append(link_enrty)

        secondary_results = traverse_obj(self.data,('contents', 'twoColumnWatchNextResults', 'secondaryResults', 'secondaryResults', 'results'),default=[])
        s_contents = list(traverse_obj(secondary_results,(...,'itemSectionRenderer', 'contents',...) ,default=[]))
        secondary_entries = self._extract_mini_feed_entry(s_contents)
        chips = list(traverse_obj(secondary_results,(...,'itemSectionRenderer', 'header', 'relatedChipCloudRenderer', 'content', 'chipCloudRenderer', 'chips',...) ,default=[]))
        chips_entries = []
        for chip in chips:
            if chip.get('chipCloudChipRenderer'):
                chips_entries.append(self._extract_filter_chips(chip))
        secondary_entries['chips'] = chips_entries
        info['secondary_results'] = secondary_entries
        end_screen_result = traverse_obj(self.data,('playerOverlays', 'playerOverlayRenderer', 'endScreen', 'watchNextEndScreenRenderer', 'results'),default=[])
        info['end_screen_videos'] = []
        for res in end_screen_result:
            if res.get('endScreenVideoRenderer'):
                esv = {}
                esv['id'] = res['endScreenVideoRenderer'].get('videoId')
                esv['thumbnails'] = traverse_obj(res,('endScreenVideoRenderer','thumbnail', 'thumbnails'),default={})
                esv['title'] = traverse_obj(res,('endScreenVideoRenderer','title','simpleText'),default='')
                info['end_screen_videos'].append(esv)
        chapters = traverse_obj(self.data,('playerOverlays', 'playerOverlayRenderer', 'decoratedPlayerBarRenderer', 'decoratedPlayerBarRenderer', 'playerBar', 'multiMarkersPlayerBarRenderer', 'markersMap',1,'value', 'chapters'),default=[])
        info['chapters'] = []
        for chapter in chapters:
            chr = {}
            chapter = chapter.get('chapterRenderer')
            chr['title'] = traverse_obj(chapter,('title','simpleText'),default= '')
            chr['thumbnails'] = traverse_obj(chapter,('thumbnail', 'thumbnails') ,default= {})
            chr['startMS'] = chapter.get('timeRangeStartMillis') or 0
            info['chapters'].append(chr)
        playlist = traverse_obj(self.data,('contents', 'twoColumnWatchNextResults', 'playlist'))
        if playlist:
            info['playlist'] = {}
            info['playlist']['title'] = traverse_obj(playlist,('playlist', 'title'), default='')
            info['playlist']['total_videos'] = traverse_obj(playlist,('playlist', 'totalVideos'),default=0)
            info['playlist']['current_index'] = traverse_obj(playlist,('playlist', 'currentIndex'),default=0)
            info['playlist']['id'] = traverse_obj(playlist,('playlist', 'playlistId'),default='')
            info['playlist']['owner'] = traverse_obj(playlist,('playlist', 'ownerName', 'simpleText'),default='')
            info['playlist']['inifinate_bool'] = traverse_obj(playlist,('playlist', 'isInfinite'),default=False)
            info['playlist']['course_bool'] = traverse_obj(playlist,('playlist', 'isCourse'),default=False)

            content = traverse_obj(playlist,('playlist', 'contents'),default=[])
            le = []
            for item in content:
                de = {}
                if data := item.get('playlistPanelVideoRenderer'):
                    de['id'] = data.get('videoId','')
                    de['title'] = traverse_obj(data,('title', 'simpleText'),default='')
                    de['thumbnails'] = traverse_obj(data,('thumbnail', 'thumbnails'),default=[])
                    de['length'] = traverse_obj(data,('lengthText','simpleText'),default='')
                    de['index'] = traverse_obj(data,('indexText', 'simpleText'),default='')
                    de['pc_watched'] = traverse_obj(data,('thumbnailOverlays', 0 , 'thumbnailOverlayResumePlaybackRenderer', 'percentDurationWatched'),default=0 , get_all=False)
                    de['selected_bool'] = data.get('selected',False)
                    de['channel_name'] = traverse_obj(data,('longBylineText', 'runs', 0, 'text'),default='')
                    de['channel_id'] = traverse_obj(data,('longBylineText' , 'runs', 0 ,'navigationEndpoint', 'browseEndpoint', 'browseId'),default='')
                    le.append(de)
            info['playlist']['items'] = le
            return info

    def _extract_mini_feed_entry(self, s_contents):
        secondary_entries = {'regular_entries':[]}
        for item in s_contents:
            if item.get('lockupViewModel'):
                secondary_entries['regular_entries'].append(self._extract_lockup_view_model(item))
            elif item.get('reelShelfRenderer'):
                title = traverse_obj(item,('reelShelfRenderer', 'title', 'runs', 0, 'text'), default= '')
                items = traverse_obj(item,('reelShelfRenderer', 'items'),default= [])
                li = []
                for i in items:
                    if i.get('shortsLockupViewModel'):
                        li.append(self._extract_lockup_view_model(i))
                secondary_entries[title] = li
            elif item.get('continuationItemRenderer'):
                secondary_entries['continuation_token'] = traverse_obj(item,('continuationItemRenderer' ,'continuationEndpoint', 'continuationCommand', 'token'),default='')
        return secondary_entries
    
    def get_mini_feed_continuation(self, token):
        headers = self.ie.generate_api_headers(ytcfg=self.ytcfg,default_client= D_CLIENT)
        response = self.ie._extract_response(
            item_id=self.item_id,
            query={'continuation':token},
            ytcfg=self.ytcfg,
            headers=headers,
            ep = 'next',
            default_client=D_CLIENT
        )
        s_contents = list(traverse_obj(response,('onResponseReceivedEndpoints', ...,'appendContinuationItemsAction', 'continuationItems'),default=[],get_all=False))
        return self._extract_mini_feed_entry(s_contents)

    def _extract_lockup_view_model(self,i):
            content = i
            rich_entry = {}
            if content.get('lockupViewModel'):
                lock_up = content.get('lockupViewModel')
                is_video = lock_up['contentType'] == 'LOCKUP_CONTENT_TYPE_VIDEO'
                is_playlist = lock_up['contentType'] == 'LOCKUP_CONTENT_TYPE_PLAYLIST'
                
                rich_entry['type'] = 'video' if is_video else 'playlist' if is_playlist else 'other'
                rich_entry['id'] = lock_up.get('contentId')
                rich_entry['title'] = traverse_obj(lock_up, ('metadata', 'lockupMetadataViewModel', 'title', 'content'))
                if is_playlist:
                    rich_entry['thumbnail'] = traverse_obj(lock_up, ('contentImage', 'collectionThumbnailViewModel','primaryThumbnail','thumbnailViewModel','image','sources'))
                    badges = traverse_obj(lock_up,('contentImage', 'collectionThumbnailViewModel','primaryThumbnail','thumbnailViewModel','overlays',0,'thumbnailOverlayBadgeViewModel','thumbnailBadges',0))
                    rich_entry['vidoe_count'] = traverse_obj(badges,('thumbnailBadgeViewModel','text'))
                    rich_entry['sub_type'] = traverse_obj(badges,('thumbnailBadgeViewModel','icon', 'sources', 0, 'clientResource', 'imageName'))
                elif is_video:
                    rich_entry['thumbnail'] = traverse_obj(lock_up, ('contentImage', 'thumbnailViewModel','image','sources'))
                    rich_entry['duration'] = traverse_obj(lock_up, ('contentImage', 'thumbnailViewModel', 'overlays', 0, 'thumbnailBottomOverlayViewModel', 'badges', 0,'thumbnailBadgeViewModel', 'text'))
                    metadata_rows = traverse_obj(lock_up, ('metadata', 'lockupMetadataViewModel', 'metadata', 'contentMetadataViewModel', 'metadataRows'), default=[])
                    rich_entry['view_count'] = traverse_obj(metadata_rows, (1, 'metadataParts', 1,'text', 'content'))
                    rich_entry['upload_date'] = traverse_obj(metadata_rows, (1, 'metadataParts', 0,'text', 'content'))
                    rich_entry['channel_name'] = traverse_obj(metadata_rows, (0, 'metadataParts', 0,'text', 'content'))
                    rich_entry['channel_id'] = traverse_obj(metadata_rows, (0, 'metadataParts', 0,'text','commandRuns',0,'onTap', 'innertubeCommand', 'browseEndpoint', 'browseId'))
                    rich_entry['channel_avatar'] = traverse_obj(lock_up, ( 'metadata','lockupMetadataViewModel','image','decoratedAvatarViewModel', 'avatar', 'avatarViewModel', 'image', 'sources'))
      
            elif content.get('shortsLockupViewModel'):
                lock_up = content.get('shortsLockupViewModel')
                rich_entry['type'] = 'short'
                rich_entry['id'] = traverse_obj(lock_up, ('onTap', 'innertubeCommand', 'reelWatchEndpoint', 'videoId'))
                rich_entry['title'] = traverse_obj(lock_up, ('overlayMetadata', 'primaryText', 'content'))
                rich_entry['view_count'] = traverse_obj(lock_up, ('overlayMetadata', 'secondaryText', 'content'))
                rich_entry['thumbnail'] = traverse_obj(lock_up, ('thumbnailViewModel', 'thumbnailViewModel', 'image', 'sources'))
                
            elif content.get('playlistRenderer'):
                lock_up = content.get('playlistRenderer')
                rich_entry['type'] = 'playlist'
                rich_entry['id'] = lock_up.get('playlistId','')
                rich_entry['title'] = traverse_obj(lock_up, ('title', 'simpleText'), default='')
                rich_entry['thumbnail'] = traverse_obj(lock_up, ('thumbnails', 0, 'thumbnails'), default=[])
                rich_entry['video_count'] = lock_up.get('videoCount','')

            return rich_entry

    def _extract_filter_chips(self, renderer):
        return {
            'text': traverse_obj(renderer, ('chipCloudChipRenderer', 'text', (('runs', 0, 'text'),'simpleText')),get_all =False) ,
            'isSelected': traverse_obj(renderer, ('chipCloudChipRenderer', 'isSelected')),
            'clickTrackingParams': traverse_obj(renderer, ('chipCloudChipRenderer', 'trackingParams')),
            'apiUrl': traverse_obj(renderer, ('chipCloudChipRenderer', 'navigationEndpoint', 'commandMetadata', 'webCommandMetadata', 'apiUrl')),
            'token': traverse_obj(renderer, ('chipCloudChipRenderer', 'navigationEndpoint', 'continuationCommand', 'token')),
            'request': traverse_obj(renderer, ('chipCloudChipRenderer', 'navigationEndpoint','continuationCommand', 'request')),
        }

    def like_and_subscribe(self,ep, query):
        headesr = self.ie.generate_api_headers(ytcfg=self.ytcfg,default_client= D_CLIENT)
        response = self.ie._extract_response(
            item_id=self.item_id,
            query=query,
            ytcfg=self.ytcfg,
            headers=headesr,
            ep = ep,
            default_client=D_CLIENT
        )
             
    def get_channel_page_data(self):
        tab = traverse_obj(self.data,('contents', 'twoColumnBrowseResultsRenderer', 'tabs'),default=[])
        info = {'tabs':[]}
        info['header'] = {}
        info['header']['title'] = traverse_obj(self.data,('header','pageHeaderRenderer', 'pageTitle'),default='')
        content = traverse_obj(self.data,('header','pageHeaderRenderer', 'content','pageHeaderViewModel'),default={})
        info['header']['image'] = traverse_obj(content,('image', 'decoratedAvatarViewModel', 'avatar', 'avatarViewModel', 'image', 'sources'),default=[])
        matadataparts = traverse_obj(content,('metadata', 'contentMetadataViewModel', 'metadataRows', ...,'metadataParts' , ... , 'text', 'content'),default=[])
        info['header']['metadata'] = [part for part in matadataparts if part]
        info['header']['subscription_bool'] = traverse_obj(content,('actions', 'flexibleActionsViewModel', 'actionsRows', 0, 'actions', 0, 'subscribeButtonViewModel', 'subscribeButtonContent', 'subscribeState', 'subscribed'),default=True)
        info['header']['description'] = traverse_obj(content,('description', 'descriptionPreviewViewModel', 'description', 'content'),default='')
        info['header']['banner'] = traverse_obj(content,('banner', 'imageBannerViewModel', 'image', 'sources'),default=[])

        selected_tab = None
        for tab in tab:
            tab = tab.get('tabRenderer') or {}
            if not tab: continue
            tab_entries = {'selected': False}
            if tab.get('selected'):
                selected_tab = tab
                tab_entries['selected'] = True
            tab_entries['title'] = tab.get('title','')
            tab_entries['endpoint'] = traverse_obj(tab,('endpoint', 'commandMetadata', 'webCommandMetadata', 'url'),default='')
            info['tabs'].append(tab_entries)
        if selected_tab:
            contents = traverse_obj(selected_tab,('content', ('sectionListRenderer','richGridRenderer'), 'contents'),get_all=False,default=[])
            info['channel_videos'] = []
            info['sections'] = []
            for content in contents:
                if content.get('richItemRenderer'):
                    info['channel_videos'].append(self._extract_lockup_view_model(content['richItemRenderer']['content']))
                elif content.get('continuationItemRenderer'):
                    info['continuation_token'] = traverse_obj(content,('continuationItemRenderer' ,'continuationEndpoint', 'continuationCommand', 'token'),default='')
                elif content.get('itemSectionRenderer'):
                    section_entry = {}
                    if content.get('itemSectionRenderer'):
                        item_contents = traverse_obj(content,('itemSectionRenderer', 'contents'),default=[])
                        for item_content in item_contents:
                            if item_content.get('channelVideoPlayerRenderer'):
                                section_entry['type'] = 'channel_video_player'
                                section_entry['title'] = traverse_obj(item_content,('channelVideoPlayerRenderer', 'title', 'runs', 0, 'text'),default= '')
                                section_entry['description'] = traverse_obj(item_content,('channelVideoPlayerRenderer', 'description', 'runs'),default= ['',])
                                section_entry['video_id'] = traverse_obj(item_content,('channelVideoPlayerRenderer', 'videoId'),default= '')
                                section_entry['view_count'] = traverse_obj(item_content,('channelVideoPlayerRenderer', 'viewCountText', 'simpleText'),default= '')
                                section_entry['published_time'] = traverse_obj(item_content,('channelVideoPlayerRenderer', 'publishedTimeText', 'runs', 0, 'text'),default= '')

                            elif item_content.get('shelfRenderer'):
                                section_entry['type'] = 'shelf'
                                section_entry['title'] = traverse_obj(item_content,('shelfRenderer', 'title', 'runs', 0, 'text'),default= '')
                                section_entry['subtitle'] = traverse_obj(item_content,('shelfRenderer', 'subtitle', 'simpleText'),default= '')
                                section_entry['play_all_url'] = traverse_obj(item_content,('shelfRenderer', 'playAllButton', 'buttonRenderer', 'navigationEndpoint', 'commandMetadata', 'webCommandMetadata', 'url'),default=[])
                                section_entry['items'] = []
                                shelf_contents = traverse_obj(item_content,('shelfRenderer', 'content', 'horizontalListRenderer', 'items'),default=[])
                                for shelf_content in shelf_contents:
                                    if shelf_content.get('lockupViewModel') or shelf_content.get('shortsLockupViewModel'):
                                        section_entry['items'].append(self._extract_lockup_view_model(shelf_content))
                            
                            elif content.get('gridRenderer'):
                                section_entry['type'] = 'grid'
                                section_entry['items'] = []
                                grid_contents = traverse_obj(content,('gridRenderer', 'items'),default=[])
                                for grid_content in grid_contents:
                                    if grid_content.get('lockupViewModel') or grid_content.get('shortsLockupViewModel'):
                                        section_entry['items'].append(self._extract_lockup_view_model(grid_content))
                    info['sections'].append(section_entry)
        return info

    def get_history_page_data(self):
        info = {'sections':[]}
        contents = traverse_obj(self.data, ('contents', 'twoColumnBrowseResultsRenderer', 'tabs', 0,'tabRenderer', 'content', 'sectionListRenderer', 'contents',), default=[])
        for section in contents:
            if section.get('itemSectionRenderer'):
                entries = traverse_obj(section,('itemSectionRenderer', 'contents'),default=[])
                section_entry = {'type': 'history', 'items': [], 'shelves': []}
                section_entry['title'] = traverse_obj(section,('itemSectionRenderer', 'header', 'itemSectionHeaderRenderer', 'title', 'simpleText'),default= '')
                for entry in entries:
                    if entry.get('lockupViewModel'):
                        section_entry['items'].append(self._extract_lockup_view_model(entry))
                    elif entry.get('reelShelfRenderer'):
                        shelf_entry = {'type': 'shelf', 'items': []}
                        shelf_entry['title'] = traverse_obj(entry,('reelShelfRenderer', 'title', 'runs', 0, 'text'), default= '')
                        items = traverse_obj(entry,('reelShelfRenderer', 'items'),default= [])
                        for i in items:
                            if i.get('shortsLockupViewModel'):
                                shelf_entry['items'].append(self._extract_lockup_view_model(i))
                        section_entry['shelves'].append(shelf_entry)
            elif section.get('continuationItemRenderer'):
                info['continuation_token'] = traverse_obj(section,('continuationItemRenderer' ,'continuationEndpoint', 'continuationCommand', 'token'),default='')

            info['sections'].append(section_entry)
        return info

    def get_video_dash_data1(self, webpage=None): # הוספנו את webpage כפרמטר
        url = self.url
        webpage_client = D_CLIENT
        self.ie._real_initialize()
        video_id = self.ie._match_id(url)
        player_ytcfg = self.ie._download_ytcfg(webpage_client, video_id) 
        ytcfg = self.ytcfg

        webpage_ytcfg = ytcfg
        client = D_CLIENT 
        
        player_url = self.ie._extract_player_url(webpage_ytcfg, player_ytcfg)
        data_sync_id = self.ie._extract_data_sync_id(webpage_ytcfg, None , player_ytcfg)
        
        # --- התיקון הקריטי: חילוץ המפתחות מתוך ה-HTML במקום None ---
        visitor_data = self.ie._extract_visitor_data(webpage, webpage_ytcfg) if webpage else None
        
        fetch_po_token_args = {
            'client': D_CLIENT,
            'visitor_data': visitor_data, # עכשיו המפתח האמיתי עובר ליוטיוב!
            'video_id': video_id,
            'data_sync_id': data_sync_id,
            'player_url': player_url,
            'webpage': webpage, # מעבירים גם את ה-HTML עצמו
            'session_index': self.ie._extract_session_index(webpage_ytcfg, player_ytcfg),
            'ytcfg': player_ytcfg ,
        }
        
        player_po_token = self.ie.fetch_po_token(
                context=_PoTokenContext.PLAYER, **fetch_po_token_args,
                required=True)
        
        fetch_gvs_po_token_func = functools.partial(
                self.ie.fetch_po_token, context=_PoTokenContext.GVS, **fetch_po_token_args)
        
        fetch_subs_po_token_func = functools.partial(
                self.ie.fetch_po_token, context=_PoTokenContext.SUBS, **fetch_po_token_args)
        
        pr = self.ie._extract_player_response(
                    client, video_id,
                    webpage_ytcfg=player_ytcfg or webpage_ytcfg,
                    player_ytcfg=player_ytcfg,
                    player_url=player_url,
                    initial_pr=None,
                    visitor_data=visitor_data,
                    data_sync_id=data_sync_id,
                    po_token=player_po_token)
        
        innertube_context = traverse_obj(player_ytcfg or self.ie._get_default_ytcfg(client), 'INNERTUBE_CONTEXT')
        sd = pr.setdefault('streamingData', {})
        sd[STREAMING_DATA_CLIENT_NAME] = 'tv_downgraded'
        sd[STREAMING_DATA_FETCH_GVS_PO_TOKEN] = fetch_gvs_po_token_func
        sd[STREAMING_DATA_PLAYER_TOKEN_PROVIDED] = True
        sd[STREAMING_DATA_INNERTUBE_CONTEXT] = innertube_context
        sd[STREAMING_DATA_FETCH_SUBS_PO_TOKEN] = fetch_subs_po_token_func
        sd[STREAMING_DATA_IS_PREMIUM_SUBSCRIBER] = None
        sd[STREAMING_DATA_AVAILABLE_AT_TIMESTAMP] = self.ie._get_available_at_timestamp(pr, video_id, client)
        for f in traverse_obj(sd, (('formats', 'adaptiveFormats'), ..., {dict})):
            f[STREAMING_DATA_CLIENT_NAME] = client
            f[STREAMING_DATA_FETCH_GVS_PO_TOKEN] = fetch_gvs_po_token_func
            f[STREAMING_DATA_IS_PREMIUM_SUBSCRIBER] = None
            f[STREAMING_DATA_PLAYER_TOKEN_PROVIDED] = bool(player_po_token)
        player_responses = [pr,]
        
        duration = traverse_obj(pr,('videoDetails','lengthSeconds'))
        *formats, subtitles = self.ie._extract_formats_and_subtitles(video_id, player_responses, player_url, None, duration)

        captions_tracks = traverse_obj(player_responses[0],('captions', 'playerCaptionsTracklistRenderer', 'captionTracks'),default=[])
        client_name = pr['streamingData'][STREAMING_DATA_CLIENT_NAME]
        innertube_client_name = pr['streamingData'][STREAMING_DATA_INNERTUBE_CONTEXT]['client']['clientName']
        fetch_subs_po_token_func = pr['streamingData'][STREAMING_DATA_FETCH_SUBS_PO_TOKEN]
        def process_language(container, base_url, lang_code, sub_name, client_name, query):
            lang_subs = container.setdefault(lang_code, [])
            fmt = 'vtt'
            query = {**query, 'fmt': fmt, 'xosf': []}
            lang_subs.append({
                'ext': fmt,
                'url': urllib.parse.urljoin('https://www.youtube.com', update_url_query(base_url, query)),
                'name': sub_name,
                'impersonate': True,
                STREAMING_DATA_CLIENT_NAME: client_name,
            })
        pot_params = {}
        already_fetched_pot = False
        for caption_track in captions_tracks:
            lang_code = (remove_start(caption_track.get('vssId') or '', '.').replace('.', '-') or caption_track.get('languageCode'))
            base_url = caption_track['baseUrl']
            is_manual_subs = caption_track.get('kind') != 'asr'
            qs = urllib.parse.parse_qs(base_url)
            if not already_fetched_pot:
                already_fetched_pot = True
                if subs_po_token := fetch_subs_po_token_func(required=True):
                    pot_params.update({
                        'pot': subs_po_token,
                        'potc': '1',
                        'c': innertube_client_name,
                    })
            orig_lang = qs.get('lang', [None])[-1]
            lang_name = self.ie._get_text(caption_track, 'name', max_runs=1)
            if is_manual_subs:
                if not lang_code:
                    continue
                process_language(subtitles, base_url, lang_code, lang_name, client_name, pot_params)
                continue
            lang_code = remove_start(lang_code, 'a-')
            lang_name = remove_end(lang_name, ' (auto-generated)')
            process_language(subtitles, base_url, f'{lang_code}-orig', f'{lang_name} (Original)', client_name, pot_params)

        return formats, subtitles, player_responses, webpage_ytcfg


# =========================================================================
# הראוט שעושה שימוש מדויק במחלקה FeedExtractor להוצאת פורמט 140
# =========================================================================

@app.route("/youtube-api/get_audio/<video_id>", methods=['GET'])
async def get_audio_stream(video_id):
    if not video_id or video_id.lower() in ['null', 'undefined', 'none', '']:
        return Response("Invalid video ID", status=400)

    user_agent = request.headers.get('User-Agent', '').lower()
    is_android = 'streamify' in user_agent
    use_encryption = is_encryption_requested(default_encrypted=True)

    if use_encryption:
        if is_android:
            device_type = "Android (Encrypted: M4A Saver + XOR)"
        else:
            device_type = "Windows/Desktop (Encrypted: High Quality + Padding)"
    else:
        device_type = f"{'Android' if is_android else 'Windows/Desktop'} (Unencrypted Direct M4A)"

    youtube_url = f"https://www.youtube.com/watch?v={video_id}"

    try:
        cache_key = f"{video_id}_{'android' if is_android else 'windows'}"
        cached_data = AUDIO_URL_CACHE.get(cache_key)

        if cached_data and time.time() < cached_data["expires"]:
            audio_url = cached_data["url"]
            info = cached_data["info"]
            logging.info(f"⚡ WARMUP HIT -> {video_id} | Instant Start!")
        else:
            def extract_using_full_class():
                # משתמשים ב-Cache לפי Video ID כדי להבטיח התאמה מלאה של Tokens לסרטון
                cached_ytcfg = YTCFG_CACHE.get(video_id)
                
                fe = FeedExtractor(youtube_url, cookies=DEFAULT_COOKIES_FILE if os.path.exists(DEFAULT_COOKIES_FILE) else 'cookies.txt')
                fe.video_id = video_id
                
                if cached_ytcfg:
                    # אם קיים בזיכרון, נדלג על הורדת ה-HTML
                    fe.ytcfg = cached_ytcfg
                    webpage = None 
                else:
                    # אם לא קיים, נוריד פעם אחת ונשמור
                    logging.info(f"🌐 Fetching fresh HTML for {video_id}")
                    webpage = fe.ie._download_initial_webpage(youtube_url, 'web', fe.video_id)
                    fe.ytcfg = fe.ie.extract_ytcfg(fe.video_id, webpage)
                    YTCFG_CACHE[video_id] = fe.ytcfg

                # חילוץ הנתונים - כאן הועבר ה-webpage (או None אם זה מה-Cache)
                formats, subtitles, player_response, ytcfg = fe.get_video_dash_data1(webpage=webpage)
                
                # בדיקת בטיחות: אם החילוץ נכשל עם ה-Cache, ננקה אותו וננסה פעם אחת אחרונה "טרי"
                if not formats and cached_ytcfg:
                    logging.warning(f"⚠️ Cache failed for {video_id}, retrying fresh...")
                    YTCFG_CACHE.pop(video_id, None)
                    return extract_using_full_class() # קריאה חוזרת ללא Cache
                    
                return formats
            formats = await asyncio.to_thread(extract_using_full_class)

            if not formats:
                raise Exception("Formats list is empty after FeedExtractor logic execution")

            target_itag = '140'
            selected_fmt = next((f for f in formats if isinstance(f, dict) and str(f.get('format_id')) == target_itag), None)

            if not selected_fmt or not selected_fmt.get('url'):
                raise Exception(f"No valid M4A audio format found for {youtube_url}.")

            audio_url = selected_fmt['url']
            info = {
                'url': audio_url,
                'format': selected_fmt.get('format_id', target_itag),
                'ext': selected_fmt.get('ext', 'm4a'),
                'http_headers': selected_fmt.get('http_headers', {})
            }

            AUDIO_URL_CACHE[cache_key] = {
                "url": audio_url,
                "info": info,
                "expires": time.time() + AUDIO_URL_TTL
            }
            if use_encryption:
                await asyncio.sleep(3)

        # --- הזרמת הנתונים לפי המסלול שנבחר (מוצפן / ללא הצפנה) ---
        client_range = request.headers.get('Range', 'Start (0)')
        fetched_format = info.get('format', 'Unknown Format')
        fetched_ext = info.get('ext', 'Unknown Ext')
        
        logging.info(f"🎵 AUDIO ROUTE HIT -> Video ID: {video_id} | Encrypted: {use_encryption}")
        logging.info(f"   -> Device Detected: {device_type}")
        logging.info(f"   -> Quality/Format fetched: {fetched_format} (Extension: {fetched_ext})")

        yt_headers = dict(info.get('http_headers', {}))
        for key in ['Range', 'range']:
            if key in yt_headers: del yt_headers[key]
        
        yt_headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            'Accept': '*/*',
            'Origin': 'https://www.youtube.com',
            'Referer': 'https://www.youtube.com/'
        })

        client_range = request.headers.get('Range')
        yt_start = 0
        yt_end = ""
        send_padding = False
        padding_start_idx = 0

        if use_encryption and not is_android:
            if client_range:
                match = re.search(r'bytes=(\d+)-(\d*)', client_range)
                if match:
                    req_start = int(match.group(1))
                    req_end_str = match.group(2)

                    if req_start < PADDING_SIZE:
                        send_padding = True
                        padding_start_idx = req_start
                        yt_start = 0
                        if req_end_str: yt_end = str(max(0, int(req_end_str) - PADDING_SIZE))
                    else:
                        yt_start = req_start - PADDING_SIZE
                        if req_end_str: yt_end = str(int(req_end_str) - PADDING_SIZE)
            else:
                send_padding = True
                padding_start_idx = 0

            yt_headers['Range'] = f"bytes={yt_start}-{yt_end}"
        else:
            if client_range:
                yt_headers['Range'] = client_range
                match = re.search(r'bytes=(\d+)-(\d*)', client_range)
                if match: yt_start = int(match.group(1))

        def fetch_stream_sync():
            return requests.get(audio_url, headers=yt_headers, stream=True, timeout=15.0)

        yt_resp = None
        max_retries = 3
        
        # מנגנון ניסיונות חוזרים חכם - לא נכנעים מיד ל-403
        for attempt in range(max_retries):
            yt_resp = await asyncio.to_thread(fetch_stream_sync)
            
            if yt_resp.status_code in [200, 206]:
                break  # ההורדה הצליחה!
                
            if yt_resp.status_code == 403:
                logging.warning(f"⚠️ YouTube 403 on attempt {attempt+1} for {video_id}. Waiting 2 seconds and retrying...")
                yt_resp.close()
                await asyncio.sleep(2)  # המתנה של 2 שניות וניסיון נוסף להציל את הקישור
            else:
                break  # שגיאה אחרת מיוטיוב (למשל 404), אין טעם לנסות שוב

        if yt_resp.status_code not in [200, 206]:
            logging.error(f"❌ YouTube Blocked permanently! Status: {yt_resp.status_code}. Clearing cache for {video_id}.")
            # הקישור באמת שרוף. מוחקים מהקאש כדי שהניסיון הבא ייצר קישור חדש
            AUDIO_URL_CACHE.pop(cache_key, None)
            YTCFG_CACHE.pop(video_id, None)
            return Response("Upstream blocked", status=502)

        excluded_headers = ['content-encoding', 'transfer-encoding', 'connection']
        response_headers = {k: str(v) for k, v in yt_resp.headers.items() if k.lower() not in excluded_headers}

        if use_encryption and not is_android:
            if 'Content-Length' in response_headers:
                original_length = int(response_headers['Content-Length'])
                if send_padding:
                    response_headers['Content-Length'] = str(original_length + (PADDING_SIZE - padding_start_idx))

            if 'Content-Range' in response_headers:
                match = re.search(r'bytes\s+(\d+)-(\d+)/(\d+|\*)', response_headers['Content-Range'])
                if match:
                    r_start, r_end, r_total = int(match.group(1)), int(match.group(2)), match.group(3)
                    new_start = padding_start_idx if send_padding else (r_start + PADDING_SIZE)
                    new_end = r_end + PADDING_SIZE
                    new_total = str(int(r_total) + PADDING_SIZE) if r_total != '*' else '*'
                    response_headers['Content-Range'] = f"bytes {new_start}-{new_end}/{new_total}"

        response_headers['Accept-Ranges'] = 'bytes'
        response_headers['X-Stream-Enc'] = '1' if use_encryption else '0'
        response_headers['Access-Control-Expose-Headers'] = 'X-Stream-Enc, Content-Range, Content-Length, Accept-Ranges'

        async def generate():
            try:
                ENCRYPTED_LIMIT = 65536 
                current_pos = yt_start

                if use_encryption and send_padding and not is_android:
                    yield PADDING_BYTES[padding_start_idx:]

                iterator = yt_resp.iter_content(chunk_size=1024 * 64)
                while True:
                    chunk = await asyncio.to_thread(lambda: next(iterator, None))
                    if not chunk: break
                    
                    if use_encryption and is_android:
                        chunk_len = len(chunk)
                        if current_pos + chunk_len <= ENCRYPTED_LIMIT:
                            yield chunk.translate(XOR_TABLE)
                        elif current_pos >= ENCRYPTED_LIMIT:
                            yield chunk
                        else:
                            split_point = ENCRYPTED_LIMIT - current_pos
                            yield chunk[:split_point].translate(XOR_TABLE) + chunk[split_point:]
                    else:
                        yield chunk
                    current_pos += len(chunk)

            finally:
                yt_resp.close()

        out_mimetype = 'application/zip' if use_encryption else 'audio/mp4'
        return Response(generate(), status=yt_resp.status_code, headers=response_headers, mimetype=out_mimetype)

    except Exception as e:
        logging.error(f"❌ Error streaming m4a for {video_id}: {e}")
        return Response(str(e), status=500)


@app.route("/youtube-api/proxy_image", methods=['GET'])
async def proxy_image():
    use_encryption = is_encryption_requested(default_encrypted=True)
    raw_url = request.args.get('u', '') or request.args.get('url', '')
    if not raw_url:
        return Response("Missing image URL", status=400)

    target_url = decrypt_text(raw_url) if use_encryption else raw_url
    if not target_url.startswith(('http://', 'https://')):
        target_url = raw_url
    if not target_url.startswith(('http://', 'https://')):
        return Response("Invalid image URL", status=400)

    try:
        async with httpx.AsyncClient(follow_redirects=True) as client:
            resp = await client.get(
                target_url,
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"},
                timeout=8.0
            )
        if resp.status_code != 200:
            return Response("Upstream image error", status=resp.status_code)

        img_bytes = resp.content
        headers = {
            'Cache-Control': 'public, max-age=86400',
            'X-Stream-Enc': '1' if use_encryption else '0',
            'Access-Control-Expose-Headers': 'X-Stream-Enc'
        }

        if use_encryption:
            encrypted_img = img_bytes.translate(XOR_TABLE)
            return Response(encrypted_img, status=200, headers=headers, mimetype='application/octet-stream')
        else:
            content_type = resp.headers.get('content-type', 'image/jpeg')
            return Response(img_bytes, status=200, headers=headers, mimetype=content_type)
    except Exception as e:
        logging.warning(f"Image proxy error: {e}")
        return Response("Image fetch failed", status=502)

@app.route("/youtube-api/ytmusic-browse/<browse_id>", methods=['GET'])
async def get_ytmusic_browse_content(browse_id):
    browse_type = request.args.get('type')
    use_encryption = is_encryption_requested(default_encrypted=False)
    
    if not browse_id or browse_id.lower() in ['null', 'undefined', 'none'] or not browse_type:
        logging.warning(f"Blocked invalid browse request: id={browse_id}, type={browse_type}")
        return jsonify(success=False, error="Invalid Browse ID or Type"), 400

    results = []
    try:
        # 1. פתרון לערוצים (yt-dlp Fallback)
        if browse_id.startswith('UC') or browse_type == 'channel':
            logging.info(f"Detected YouTube Channel ID: {browse_id}. Using robust yt-dlp fallback.")
            
            def get_channel_videos():
                urls_to_try = [
                    f"https://www.youtube.com/channel/{browse_id}",
                    f"https://www.youtube.com/channel/{browse_id}/videos"
                ]
                ydl_opts = {
                    'extract_flat': True, 'quiet': True, 'playlist_items': '1-100',
                    'ignoreerrors': True, 'no_warnings': True,
                }
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    for url in urls_to_try:
                        try:
                            info = ydl.extract_info(url, download=False)
                            if info and 'entries' in info and len(list(filter(None, info['entries']))) > 0:
                                return info
                        except: continue
                    return None

            channel_info = await asyncio.to_thread(get_channel_videos)
            if channel_info and 'entries' in channel_info:
                for entry in channel_info['entries']:
                    if not entry: continue
                    results.append({
                        "type": "song", "id": entry.get("id"), "title": entry.get("title"),
                        "duration": entry.get("duration", 0),
                        "author": entry.get("uploader", "") or entry.get("channel", ""),
                        "thumbnail_url": entry.get("thumbnails", [{}])[-1].get("url") if entry.get("thumbnails") else None
                    })
                if use_encryption:
                    results = encrypt_results_list(results)
                return jsonify({"success": True, "encrypted": use_encryption, "results": results})

        # 2. לוגיקה עבור YouTube Music (אמנים, אלבומים, פלייליסטים, פודקאסטים)
        tracks = []
        if browse_type in ['artist', 'channel']:
            # 1. ננסה למשוך כ"אמן" רשמי של YouTube Music
            try:
                artist = await asyncio.to_thread(ytmusic.get_artist, browse_id)
                if artist.get('songs', {}).get('browseId'):
                    playlist_id = artist['songs']['browseId']
                    content = await asyncio.to_thread(ytmusic.get_playlist, playlist_id, limit=500)
                    tracks = content.get('tracks', [])
                elif artist.get('albums', {}).get('results'):
                    first_album = artist['albums']['results'][0]
                    if first_album.get('browseId'):
                        album_details = await asyncio.to_thread(ytmusic.get_album, first_album['browseId'])
                        tracks = album_details.get('tracks', [])
                elif artist.get('singles', {}).get('results'):
                    first_single = artist['singles']['results'][0]
                    if first_single.get('browseId'):
                        single_details = await asyncio.to_thread(ytmusic.get_album, first_single['browseId'])
                        tracks = single_details.get('tracks', [])
            except Exception as e:
                logging.warning(f"get_artist failed for {browse_id}: {e}")

            # 2. גיבוי ראשון: ננסה למשוך אותו כמשתמש רגיל ב-YT Music (User Profile)
            if not tracks:
                try:
                    user_profile = await asyncio.to_thread(ytmusic.get_user, browse_id)
                    if user_profile.get('videos', {}).get('results'):
                        tracks = user_profile['videos']['results']
                    elif user_profile.get('playlists', {}).get('results'):
                         first_pl = user_profile['playlists']['results'][0].get('browseId')
                         if first_pl:
                             content = await asyncio.to_thread(ytmusic.get_playlist, first_pl, limit=500)
                             tracks = content.get('tracks', [])
                except Exception as e2:
                    logging.warning(f"get_user fallback failed: {e2}")

            # 3. גיבוי שני: ננסה למשוך את פלייליסט ההעלאות הסודי (UU)
            if not tracks:
                try:
                    uploads_id = browse_id.replace("UC", "UU", 1) if browse_id.startswith("UC") else browse_id
                    content = await asyncio.to_thread(ytmusic.get_playlist, uploads_id, limit=500)
                    tracks = content.get('tracks', [])
                except Exception as e3:
                    logging.warning(f"UU playlist fallback failed: {e3}")
            
            # 4. גיבוי אחרון ואגרסיבי: yt-dlp על עמוד הבית של הערוץ (ללא טאב /videos שעושה שגיאות)
            if not tracks:
                try:
                    logging.info(f"Using yt-dlp ultimate fallback for {browse_id}")
                    ydl_opts = {'extract_flat': True, 'quiet': True}
                    channel_url = f"https://www.youtube.com/channel/{browse_id}"
                    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                        info = await asyncio.to_thread(lambda: ydl.extract_info(channel_url, download=False))
                        
                    if info and 'entries' in info:
                        for entry in info['entries']:
                            if entry and entry.get('id'):
                                tracks.append({
                                    'videoId': entry.get('id'),
                                    'title': entry.get('title'),
                                    'duration_seconds': entry.get('duration'),
                                    'author': entry.get('uploader') or info.get('uploader', ''),
                                    'thumbnails': [{'url': entry.get('thumbnails', [{}])[-1].get('url')}] if entry.get('thumbnails') else []
                                })
                except Exception as e4:
                    logging.error(f"yt-dlp ultimate fallback failed for {browse_id}: {e4}")

        elif browse_type in ['album', 'playlist', 'podcast']:
            limit = 500
            if browse_type == 'album':
                content = await asyncio.to_thread(ytmusic.get_album, browse_id)
                tracks = content.get('tracks', [])
            elif browse_type == 'podcast':
                content = await asyncio.to_thread(ytmusic.get_podcast, browse_id, limit=limit)
                tracks = content.get('episodes', [])
            elif browse_type == 'playlist':
                content = await asyncio.to_thread(ytmusic.get_playlist, browse_id, limit=limit)
                tracks = content.get('tracks', [])

        # 3. עיבוד השירים ותיקון IDs חסרים (קריטי לאלבומים)
        if tracks:
            # איתור שירים ללא VideoId (קורה הרבה באלבומים)
            search_tasks = []
            for i, track in enumerate(tracks):
                if track and not track.get("videoId"):
                    author_list = track.get('artists')
                    author_str = ", ".join([a.get('name', '') for a in author_list if a.get('name')]) if author_list else track.get('author', '')
                    query = f"{track.get('title', '')} {author_str} audio"
                    search_tasks.append((i, query))
            
            if search_tasks:
                async def find_replacement(idx, q):
                    try:
                        res = await asyncio.to_thread(ytmusic.search, q, filter='songs', limit=1)
                        return idx, res[0]["videoId"] if res and res[0].get("videoId") else None
                    except: return idx, None

                replacements = await asyncio.gather(*(find_replacement(idx, q) for idx, q in search_tasks))
                for idx, new_id in replacements:
                    if new_id: tracks[idx]["videoId"] = new_id

            # בניית התוצאה הסופית ללקוח
            for track in tracks:
                if not track or not track.get("videoId"): continue
                
                author_list = track.get('artists')
                author_str = ", ".join([a['name'] for a in author_list]) if author_list else track.get('author', '')
                
                thumb = None
                if track.get("thumbnails"):
                    thumb = track["thumbnails"][-1].get("url")

                results.append({
                    "type": "song",
                    "id": track["videoId"],
                    "title": track.get("title", ""),
                    "duration": track.get("duration_seconds", 0),
                    "author": author_str,
                    "thumbnail_url": thumb
                })

        if use_encryption:
            results = encrypt_results_list(results)

        return jsonify({"success": True, "encrypted": use_encryption, "results": results})

    except Exception as e:
        logging.error(f"Error browsing {browse_id}: {str(e)}", exc_info=True)
        return jsonify(success=False, error=str(e)), 500
    
session = requests.Session()
session.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/91.0.4472.124 Safari/537.36"
})

@app.route("/youtube-api/suggestions", methods=['GET'])
async def get_suggestions():
    query = request.args.get('q', '')
    if not query:
        return jsonify([])
    
    use_encryption = is_encryption_requested(default_encrypted=False)
    if use_encryption:
        query = decrypt_text(query)

    encoded_q = urllib.parse.quote(query)
    url = f"https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q={encoded_q}"
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(url, timeout=3.0)
            data = response.json()
            
        if isinstance(data, list) and len(data) > 1 and isinstance(data[1], list):
            suggestions = data[1]
            if use_encryption:
                suggestions = [encrypt_text(str(s)) for s in suggestions]
            return jsonify(suggestions)
        return jsonify([])
        
    except Exception as e:
        logging.error(f"Suggestions error: {e}")
        return jsonify([])

@app.route("/youtube-api/restart", methods=['POST', 'GET'])
async def restart_server():
    async def exit_soon():
        await asyncio.sleep(0.5)
        os._exit(0) 
    asyncio.create_task(exit_soon())
    return jsonify({"success": True, "message": "Server is restarting..."})

@app.route("/youtube-api", methods=['GET'])
async def youtube_api_handler():
    action = request.args.get('action')
    use_encryption = is_encryption_requested(default_encrypted=False)

    if action == 'search_and_download_video':
        query = request.args.get('query') or request.headers.get('X-Search-Query')
        if query: query = urllib.parse.unquote(query, encoding='utf-8')
        search_engine = request.args.get('search_engine', 'youtube')
        
        if use_encryption and query:
            query = decrypt_text(query)

        # === חיפושים מקבילים עבור טאב "הכל" ===
        if search_engine == 'youtubemusic_all':
            tasks = [
                search_youtube(query, search_engine='youtubemusic_songs'),
                search_youtube(query, search_engine='youtubemusic_albums'),
                search_youtube(query, search_engine='youtubemusic_playlists'),
                search_youtube(query, search_engine='youtubemusic_artists'),
                search_youtube(query, search_engine='youtubemusic_podcasts')
            ]
            
            responses = await asyncio.gather(*tasks, return_exceptions=True)
            combined_results = []
            
            if isinstance(responses[0], dict) and responses[0].get('success'):
                combined_results.extend(responses[0].get('results', [])[:15]) # שירים
            if isinstance(responses[1], dict) and responses[1].get('success'):
                combined_results.extend(responses[1].get('results', [])[:8])  # אלבומים
            if isinstance(responses[2], dict) and responses[2].get('success'):
                combined_results.extend(responses[2].get('results', [])[:8])  # פלייליסטים
            if isinstance(responses[3], dict) and responses[3].get('success'):
                combined_results.extend(responses[3].get('results', [])[:8])  # אמנים
            if isinstance(responses[4], dict) and responses[4].get('success'):
                combined_results.extend(responses[4].get('results', [])[:8])  # פודקאסטים

            valid_results = [r for r in combined_results if r.get('id') and str(r.get('id')).lower() not in ['null', 'none', 'undefined', '']]
            if use_encryption:
                valid_results = encrypt_results_list(valid_results)
            return jsonify({"success": True, "encrypted": use_encryption, "results": valid_results})
        # ==============================================================

        # חיפוש רגיל (או טעינת פלייליסט/לינק)
        search_resp = await search_youtube(query, search_engine=search_engine)
        if not search_resp['success']:
            return jsonify(success=False, error=search_resp.get('error', 'Search failed')), 500

        results = search_resp.get('results', [])
        valid_results = [r for r in results if r.get('id') and str(r.get('id')).lower() not in ['null', 'none', 'undefined', '']]
        if not search_engine.startswith('youtubemusic'):
            valid_results = valid_results[:150]

        out_resp = dict(search_resp)
        out_resp['encrypted'] = use_encryption
        if use_encryption:
            out_resp['results'] = encrypt_results_list(valid_results)
            if out_resp.get('playlistTitle') and isinstance(out_resp['playlistTitle'], str):
                out_resp['playlistTitle'] = encrypt_text(out_resp['playlistTitle'])
        else:
            out_resp['results'] = valid_results

        return jsonify(out_resp)

    return jsonify(success=False, error="Invalid action"), 400


@app.route("/health", methods=["GET"])
async def health():
    return jsonify(success=True, msg="ok")

@app.before_serving
async def start_background_tasks():
    async def cleanup_task():
        while True:
            await asyncio.sleep(180)  # ניקוי כל 3 דקות
            try:
                await cleanup_expired_cache()
            except Exception as e:
                logging.error(f"Cache cleanup failed: {e}")

    asyncio.create_task(cleanup_task())
# --- הפעלת השרת ---
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5008)