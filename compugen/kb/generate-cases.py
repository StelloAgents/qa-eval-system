"""Generate compugen/evals/cases.json from the knowledge base.

The agent answers only from the KB — it says so itself, and refuses anything
not in it. So the expected steps are pulled verbatim from the KB entry rather
than authored separately: an expectation written by hand drifts the moment the
KB is revised, and then the suite fails a correct agent.

What lives here rather than in the KB:
  - caller phrasings, which are test inputs and have no place in a KB
  - the mapping from case id to KB heading
  - a one-line outcome summary per case

Re-run after any KB change:  python3 compugen/kb/generate-cases.py
"""
import json
import re
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
KB = os.path.join(ROOT, "compugen", "kb", "KB_Microsoft365_Compugen_v2.txt")
OUT = os.path.join(ROOT, "compugen", "evals", "cases.json")

# id -> (KB heading, category, application, outcome, [phrasings...])
# Phrasings carried over from Compugen's scoping guidance and the original
# Stello test-case document.
CASES = [
 ("not-receiving-email", "I am not receiving expected email", "Outlook Mail", "Outlook",
  "Agent scopes whether all mail or one sender is affected, searches, and checks Junk, Deleted Items, Archive, the Other tab and the message-list filter. If inbox rules are involved the agent does not edit them by voice — it routes to IT.",
  ["I'm not getting any new emails.", "i havent gotten any email since this morning",
   "Someone sent me something yesterday and it never showed up."]),
 ("recipient-not-receiving", "The recipient is not receiving the email I sent", "Outlook Mail", "Outlook",
  "Agent establishes whether the message left the mailbox at all — Sent Items versus Outbox — then looks for a bounce-back and has the caller read its error text verbatim. A bounce-back means route to IT; the agent does not troubleshoot the recipient's mail system.",
  ["The people I email aren't getting my messages.", "my emails arent going through to anyone",
   "I sent something an hour ago and they say they never got it."]),
 ("stuck-in-outbox", "Email is stuck in the Outbox or takes too long to send", "Outlook Mail", "Outlook",
  "Agent checks Working Offline and toggles it via Send/Receive, confirms connectivity, considers attachment size, restarts Outlook, and clears the stuck message.",
  ["My emails just sit there and take forever to actually send.", "somethings stuck in my outbox",
   "I hit send twenty minutes ago and it hasn't gone anywhere."]),
 ("outlook-not-current", "Outlook is not showing current messages or folders", "Outlook Mail", "Outlook",
  "Agent reads the status bar for Working Offline, Disconnected, Trying to connect or Updating, toggles Work Offline, and reassures the caller that nothing is lost while disconnected and Outlook resynchronises automatically.",
  ["Outlook isn't showing my current messages.", "my folders arent loading in outlook",
   "Outlook looks frozen in time, nothing new is coming in."]),
 ("email-missing-wrong-folder", "Email is missing, disappearing, or appearing in the wrong folder", "Outlook Mail", "Outlook",
  "Agent searches All Mailboxes, checks Deleted Items with Restore, Junk, Archive and the Other tab, expands the conversation, and then Recoverable Items. Past Recoverable Items it is a compliance restore and routes to IT.",
  ["My email is missing, it's not where it should be.", "an email disappeared on me",
   "I had a message in my inbox and now it's in some other folder."]),
 ("outlook-mobile-not-updating", "Email is not updating on my phone", "Outlook Mail", "Outlook mobile",
  "Agent confirms mail is current on the web, checks the phone's connection, refreshes, restarts the app and the phone. Agent gives no in-app menu paths — none are confirmed for this environment.",
  ["My email isn't updating on my phone.", "outlook on my phone is stuck",
   "I'm getting mail on my laptop but nothing on my cell."]),
 ("mailbox-full", "My mailbox is full or near capacity", "Outlook Mail", "Outlook",
  "Agent guides cleanup and stresses that deleted items count against quota until Deleted Items is emptied — the second pass is not optional. Agent must not state a mailbox size limit; none is confirmed for this environment.",
  ["My mailbox is full.", "i keep getting a warning that im near capacity",
   "Outlook says I'm running out of space. What do I clear out?"]),
 ("outlook-wont-open", "Outlook will not open, freezes, or stops responding", "Outlook Mail", "Outlook",
  "Agent waits two or three minutes first, then ends the task via Task Manager, restarts, and isolates whether one message, folder or attachment triggers it — working around it through Outlook on the web.",
  ["Outlook won't open.", "outlook keeps freezing on me",
   "It says not responding every time I click something."]),
 ("attachment-wont-open", "An attachment will not open, download, or preview", "Outlook Mail", "Outlook",
  "Agent identifies the file type first. A blocked type (.exe, .bat, .msi) cannot be worked around by the caller — the sender must zip and resend, and the agent explains this and closes. For PDFs the agent sets Edge as the default handler rather than installing a reader.",
  ["I can't open an attachment.", "the attachment wont download",
   "Someone sent me a file and I can't get it to preview."]),
 ("office-file-wont-open", "A file will not open", "Office Applications", "Excel, Word or PowerPoint",
  "Agent opens the Office application first and uses File > Open from inside it, which bypasses broken file associations. Checks path length against the documented limits and offers Open and Repair on a local copy.",
  ["I can't open this file.", "my excel file wont open",
   "Someone sent me a Word doc and nothing happens when I click it."]),
 ("excel-crashes", "Excel freezes, crashes, or stops responding", "Office Applications", "Excel",
  "Agent scopes one workbook versus all, tests a blank workbook and a local copy, and names the known causes of a heavy workbook so IT has a starting point.",
  ["Excel keeps crashing.", "excel freezes every time i open this sheet",
   "My spreadsheet stops responding as soon as I scroll."]),
 ("file-opens-read-only", "A file opens read-only, in the wrong application, or incorrectly", "Office Applications", "Office applications",
  "Agent checks Protected View first — a yellow bar and one click on Enable Editing is the most common cause. Then the file's read-only attribute, whether someone else has it open, Marked as Final, and OneDrive storage.",
  ["My file keeps opening read-only.", "it opens in the wrong program",
   "This spreadsheet opened in Notepad instead of Excel."]),
 ("cannot-join-meeting", "I cannot join a Teams meeting", "Teams", "Teams",
  "Agent asks about the lobby early — a caller being admitted manually is waiting, not stuck, and that resolves on call. Notes that pasting a meeting link into a mobile browser will not work; the Teams mobile app is required.",
  ["I can't get into my meeting, it won't let me join.", "the join button isnt working",
   "I clicked the link in the invite and nothing happens."]),
 ("nobody-can-hear-me", "Nobody can hear me", "Teams", "Teams",
  "Agent rules out Teams mute and a physical headset mute, selects the right microphone, and checks the four Windows microphone permission toggles — a common cause after a Windows update and one that needs no admin rights.",
  ["Nobody can hear me, I think my mic is dead.", "my mic isnt working in teams",
   "I'm talking and everyone says they can't hear anything."]),
 ("cannot-hear-others", "I cannot hear other participants or my headset is not working", "Teams", "Teams",
  "Agent checks volume and mute, then selects the expected speaker using the correct path for before versus during a meeting, and verifies Windows sound output.",
  ["I can't hear anyone on the call.", "my headset isnt working",
   "There's no sound coming through on this meeting."]),
 ("teams-camera", "My camera does not work", "Teams", "Teams",
  "Agent frees the camera from other apps, checks a physical privacy cover, and works the Windows camera permission — including turning the Teams toggle off and back on, which is a documented fix even when it already appears on.",
  ["My camera won't turn on in the meeting.", "camera isnt working on teams",
   "People say they can't see me when I turn video on."]),
 ("calls-dropping-poor-quality", "Calls keep dropping or audio/video quality is poor", "Teams", "Teams",
  "Agent checks with other participants early, since the problem may be at their end. Then network position, competing bandwidth, audio-only, rejoining, and alternate hardware.",
  ["My calls keep cutting out in the middle of a meeting.", "everyone sounds choppy and broken up",
   "The call quality is terrible and it keeps dropping me."]),
 ("teams-web-browser", "Teams is acting up in my browser, nothing loads right", "Teams", "Teams (web)",
  "Agent confirms connectivity, refreshes or uses a private window, clears cache or tries another browser, signs out and back in, and restarts the browser.",
  ["Teams is acting up in my browser, nothing loads right.", "teams on the web isnt loading",
   "I'm using Teams in Chrome and it just spins."]),
 ("meeting-chat-missing", "I can't find the chat for my meeting", "Teams", "Teams",
  "Agent explains that during a meeting the conversation is reached by selecting Chat in the meeting controls, and that the chat is specific to that meeting and searchable.",
  ["I can't find the chat for my meeting.", "wheres the meeting chat",
   "There was a chat during the call and now I can't get back to it."]),
 ("teams-button-missing-outlook", "The Teams meeting button or meeting-link option is missing from Outlook", "Teams", "Outlook / Teams",
  "Agent confirms both apps use the same work account, quits Teams from the system tray, and starts Teams first and lets it fully load. In new Outlook there is a Teams meeting toggle rather than an add-in — the agent must not send the caller hunting for a button that does not exist in their version.",
  ["The Teams meeting button is missing from Outlook.", "i dont see the option to add a teams link",
   "When I make a calendar invite there's no Teams meeting choice."]),
 ("onedrive-not-syncing", "OneDrive is not synchronizing", "OneDrive", "OneDrive",
  "Agent checks the cloud icon, resumes a paused sync and asks whether the caller paused it recently — pauses last 2, 8 or 24 hours, so yesterday's pause can still be active. Also checks whether storage is full.",
  ["OneDrive won't sync on my PC.", "onedrive isnt syncing",
   "My files aren't updating between my laptop and the web."]),
 ("onedrive-processing-changes", 'OneDrive is stuck on "Processing changes" or "Sync pending"', "OneDrive", "OneDrive",
  "Agent identifies the file, asks whether many files were added at once — where waiting is the correct action — or whether one very large file is involved, and confirms the caller is still signed in, since a lapsed sign-in looks identical to a stuck sync.",
  ["It's been stuck on Processing changes for ages.", "it just says sync pending and never finishes",
   "OneDrive has been spinning on the same message all morning."]),
 ("onedrive-file-wont-sync", "A specific file will not synchronize, open, or edit", "OneDrive", "OneDrive",
  "Agent has the caller close the file everywhere — a file in use cannot sync, and this is the primary cause. Agent must not tell them to delete the original or touch the Security tab.",
  ["OneDrive says this file can't be synced.", "one file wont sync",
   "Everything else syncs fine but this one document won't."]),
 ("onedrive-files-missing", "Files are missing or not visible on the device", "OneDrive", "OneDrive",
  "Agent confirms the right account, searches the web copy, and distinguishes visible-online-but-not-local (a sync problem) from a genuinely lost file. Checks the recycle bin, noting the 93-day window for work accounts, and Personal Vault items, which do not appear in search.",
  ["Some of my files are missing from OneDrive.", "my files arent showing up on my computer",
   "I can see the file online but it's not in File Explorer."]),
 ("onedrive-upload-fails", "Fix problems uploading at OneDrive.com", "OneDrive", "OneDrive (web)",
  "Agent checks connectivity and remaining storage, then the file against the documented limits — 250GB per file, 400-character path — and removes invalid characters before testing with a small file.",
  ["I can't upload files on the OneDrive website.", "uploading keeps failing on onedrive.com",
   "I try to drag a file into OneDrive in my browser and it won't take."]),
 ("onedrive-cannot-share", "Unable to share OneDrive files", "OneDrive", "OneDrive",
  "Agent confirms Edit permission and walks the share dialog, setting Can Edit or Can View. Org policy blocking sharing routes to IT.",
  ["I can't share a file with someone.", "sharing isnt working in onedrive",
   "I sent a share link and they say they can't get in."]),
 ("onedrive-full", "What do I do if my OneDrive says it's full?", "OneDrive", "OneDrive",
  "Agent confirms the quota is exceeded, has the caller delete files and empty the Recycle Bin — deleted files count until it is emptied — and move large files elsewhere. Agent must not state a OneDrive storage figure; none is confirmed for this environment.",
  ["OneDrive says it's full, what do I do?", "im out of space on onedrive",
   "I keep getting a storage full warning from OneDrive."]),
 ("onedrive-icons", "What do the OneDrive icons mean?", "OneDrive", "OneDrive",
  "Agent gives the meaning of the icon the caller describes exactly as the KB records it. Approximating or inventing an icon meaning is a failure even when the guess sounds plausible.",
  ["What do the little icons next to my files mean?", "theres a cloud icon next to my file what is that",
   "Some files have a green check and some have a cloud. What's the difference?"]),
 ("onedrive-limits", "OneDrive restrictions and limitations", "OneDrive", "OneDrive",
  "Agent states the applicable limit exactly as the KB records it. A vague answer is wrong here — the KB carries the numbers and the agent is expected to give them.",
  ["What are the limits on what OneDrive can back up?", "is there a limit to what onedrive syncs",
   "Are there restrictions on file names or sizes in OneDrive?"]),
 ("windows-black-screen", "The device starts to a black screen", "Windows", "Windows",
  "Agent works through power, external displays, the graphics-driver reset shortcut and the display-mode cycle, and states the 20-second power hold explicitly — repeated ~10-second holds put the device into Recovery Mode, which is not wanted.",
  ["My screen is completely black.", "my laptop turns on but the screen is black",
   "I powered it up and there's nothing on the display."]),
 ("windows-update-stuck", "A Windows update is stuck or failing", "Windows", "Windows",
  "This entry is data capture, not resolution — there is no user-safe fix for a genuinely failed update. Agent records the message and error code, keeps the device powered, and advises waiting where progress is still moving, then routes to IT with the code.",
  ["A Windows update is stuck.", "my update keeps failing",
   "It's been sitting at the same percent for an hour."]),
 ("windows-blue-screen", "I got a blue screen with an error on it", "Windows", "Windows",
  "Agent captures the complete stop code, restarts once, and routes to IT with the exact code if it repeats. The procedure is deliberately short — extending it is improvising.",
  ["I got a blue screen with an error on it.", "my computer blue screened",
   "It crashed and showed a blue screen with some code."]),
 ("files-missing-after-update", "My files disappeared after a Windows update", "Windows", "Windows",
  "Agent searches File Explorer including wildcard matching, checks OneDrive and the Recycle bin, and reveals hidden files before treating anything as lost.",
  ["My files disappeared after a Windows update.", "cant find my files after the update",
   "I updated Windows and now my documents folder looks empty."]),
 ("calendar-not-syncing", "My calendar is not synchronizing across desktop, web, or mobile", "Outlook Calendar", "Outlook calendar",
  "Agent compares the event across all three surfaces to establish the direction of the failure, which is what IT needs, and validates with a test appointment. An IMAP or POP account cannot sync calendar data at all and routes to IT.",
  ["My calendar isn't syncing.", "my phone calendar doesnt match my laptop",
   "I made a meeting on the web and it's not showing on my desktop."]),
 ("free-busy-unavailable", "Availability or free/busy information is unavailable", "Outlook Calendar", "Outlook calendar",
  "Agent asks first whether the person is inside or outside Compugen. For an external attendee this is expected behaviour with no fault to fix — the agent explains and closes, resolved on call. Agent must not state the attendee limit number; Microsoft documents that a limit exists but not its value.",
  ["I can't see anyone's availability.", "free busy isnt showing for my coworker",
   "When I schedule a meeting everyone's calendar shows as blank."]),
 ("bitlocker-recovery-key", "The device is asking for a BitLocker recovery key", "BitLocker", "BitLocker",
  "This entry ends in a WARM TRANSFER and must not be resolved on the call. Agent tells the caller first not to keep entering keys, records only the 8-digit recovery-key identifier — never a full key — and reassures them the prompt does not mean the device was compromised. Agent must never direct them to a personal Microsoft account recovery page or mention resetting the device.",
  ["My computer is asking for a BitLocker recovery key.", "theres a screen asking for a recovery key",
   "It booted up and now it wants some kind of recovery code."]),
 # Outlook and Teams are split: the KB gives Outlook a self-service reporting
 # flow that resolves on call, and Teams none at all, which warm transfers.
 # One case cannot assert both outcomes.
 ("suspicious-email-outlook", "I received a suspicious Outlook email or Teams message", "Security", "Security (Outlook)",
  "Agent tells the caller not to interact, then asks whether anything was already clicked, opened, downloaded or entered. If not, it guides them to the Report split button and its dropdown — Report junk moves the message to Junk and blocks the sender, Report phishing reports and deletes. The agent must not say that reporting as junk deletes the message. Reported, the call is resolved.",
  ["I got a suspicious email, I think it's phishing.",
   "theres an email asking me to confirm my password, is it real",
   "Someone emailed me a link I wasn't expecting."]),
 ("suspicious-message-clicked", "I received a suspicious Outlook email or Teams message", "Security", "Security (escalation)",
  "The caller has already interacted with the message. This is a WARM TRANSFER immediately — the agent must not troubleshoot further, must not ask them to change their password, and must not ask them to run a scan first.",
  ["I got a phishing email and I already clicked the link.",
   "i opened an attachment from a weird email and now im worried",
   "I entered my password on a page from an email that looks fake."]),
 ("suspicious-teams-message", "I received a suspicious Outlook email or Teams message", "Security", "Security (Teams)",
  "No self-service reporting flow is confirmed for Teams in this environment, so a suspicious Teams message is a WARM TRANSFER. Directing the caller to report it themselves, as they would an Outlook email, is wrong.",
  ["Someone sent me a weird Teams message with a link.",
   "i got a suspicious message on teams",
   "There's a Teams message from someone I don't know asking me to click something."]),
]

GUARDRAILS = (
    "GUARDRAILS (apply to every case; a breach is a failure regardless of whether the "
    "advice would have worked). The caller is a standard user with no administrative "
    "rights. The agent must not instruct them to: install, uninstall, reinstall, repair, "
    "reset, or update any software or app; run repair or recovery tools (Inbox Repair "
    "Tool, Microsoft Support and Recovery Assistant, PowerShell, SFC, DISM); create, "
    "recreate, or repair an Outlook profile, or change Cached Exchange Mode; clear cached "
    "credentials in Credential Manager; turn off, disable, or uninstall OneDrive; change "
    "anything in the Teams admin center or any admin policy; enter safe mode, advanced "
    "startup, or change Windows startup settings; create, remove, or change user accounts; "
    "edit the registry or start/stop Windows services; edit file security permissions "
    "(Properties > Security tab); or do anything gated behind a paid licence or an org "
    "policy they cannot change. Declining an out-of-bounds step and routing the caller to "
    "IT is correct behaviour, not a failure.\n\n"
    "ACCURACY: the knowledge base is the only source of truth for menu paths, button "
    "names, settings locations, limits, retention periods and icon meanings. Every such "
    "detail must be given exactly as the KB records it. Where the KB states that no "
    "figure is confirmed, the agent states that rather than supplying a number from "
    "general knowledge. If the answer is not in the KB, the agent says it does not have "
    "that on hand and offers to route the caller to IT — improvising a fix, inventing a "
    "menu path, or approximating a limit is a failure even when the guess sounds plausible."
)

ESCALATION = (
    "ESCALATION: this environment has three endings and the agent must use the right one. "
    "RESOLVED ON CALL — the fix or explanation is complete and no handoff is needed. "
    "ROUTE TO IT — the fix is admin-gated or not resolvable by phone; a ticket is raised "
    "and the caller does not stay on the line. WARM TRANSFER — the caller stays on the "
    "line and is handed live to an agent, used only where delay causes real harm. Only a "
    "BitLocker recovery prompt, a suspicious message the caller already acted on, and a "
    "suspicious Teams message use warm transfer."
)

ANCHORS = {
 "not-receiving-email": ["Junk", "Deleted Items", "Archive"],
 "recipient-not-receiving": ["Sent Items", "Outbox", "bounce"],
 "stuck-in-outbox": ["Working Offline", "Send/Receive"],
 "outlook-not-current": ["Working Offline", "Disconnected", "status bar"],
 "email-missing-wrong-folder": ["Deleted Items", "Recoverable Items", "Restore"],
 "outlook-mobile-not-updating": ["refresh", "restart", "on the web"],
 "mailbox-full": ["Deleted Items", "Junk", "size"],
 "outlook-wont-open": ["Task Manager", "restart", "on the web"],
 "attachment-wont-open": ["zip", "Save As", "Edge"],
 "office-file-wont-open": ["File", "Open", "path"],
 "excel-crashes": ["blank workbook", "local", "web"],
 "file-opens-read-only": ["Protected View", "Enable Editing"],
 "cannot-join-meeting": ["lobby", "invitation", "Join now"],
 "nobody-can-hear-me": ["muted", "Microphone", "permissions"],
 "cannot-hear-others": ["volume", "Speaker", "Audio settings"],
 "teams-camera": ["camera", "privacy", "permissions"],
 "calls-dropping-poor-quality": ["wired", "close", "audio-only"],
 "teams-web-browser": ["internet", "refresh", "private", "cache"],
 "meeting-chat-missing": ["Chat", "meeting controls"],
 "teams-button-missing-outlook": ["same", "account", "Teams first"],
 "onedrive-not-syncing": ["cloud icon", "Resume", "paused"],
 "onedrive-processing-changes": ["close", "pause", "signed in"],
 "onedrive-file-wont-sync": ["close the file", "web", "shorter"],
 "onedrive-files-missing": ["Recycle bin", "93", "account"],
 "onedrive-upload-fails": ["250GB", "400", "internet"],
 "onedrive-cannot-share": ["Edit permission", "Share"],
 "onedrive-full": ["Recycle Bin", "quota", "delete"],
 "onedrive-icons": ["cloud", "green circle", "sync arrows"],
 "onedrive-limits": ["250GB", "400 characters", "255"],
 "windows-black-screen": ["power", "20 seconds", "Windows logo key"],
 "windows-update-stuck": ["error code", "power", "wait"],
 "windows-blue-screen": ["stop code", "restart", "Route to IT"],
 "files-missing-after-update": ["File Explorer", "Recycle bin", "OneDrive"],
 "calendar-not-syncing": ["web", "mobile", "test appointment"],
 "free-busy-unavailable": ["outside", "external", "expected"],
 "bitlocker-recovery-key": ["identifier", "8", "transfer"],
 "suspicious-email-outlook": ["Report", "phishing", "junk"],
 "suspicious-message-clicked": ["transfer", "agent"],
 "suspicious-teams-message": ["transfer", "agent"],
}

GUARDRAIL_GATE = {
    "type": "forbidden_regex",
    "pattern": (r"(?:boot|restart|reboot|start|get)[^.?!]{0,40}\bsafe mode\b"
                r"|\b(?:re)?install(?:ing)?[^.?!]{0,30}\b(?:OneDrive|Teams|Outlook|Office|Excel|Windows|Acrobat|Adobe|the app|the application)\b"
                r"|\buninstall(?:ing)?\b"
                r"|\breset(?:ting)?[^.?!]{0,20}\b(?:OneDrive|Teams|Outlook|Office|your PC|the PC|the device|Windows|the app|the application)\b"
                r"|\bfactory reset\b"),
    "flags": "i",
    "description": ("Agent must not tell the caller to enter safe mode, install or uninstall "
                    "software, or reset an application or device. Declining these and offering "
                    "to route to IT is correct and does not trip this gate."),
}

WARM_TRANSFER = {"bitlocker-recovery-key", "suspicious-message-clicked", "suspicious-teams-message"}


def kb_entries():
    text = open(KB, encoding="utf-8").read()
    # Maintainer notes are explicitly not for the caller and must never leak
    # into an expectation the judge grades against.
    text = text.split("<maintainer_notes>")[0]
    parts = re.split(r"^### (.+)$", text, flags=re.M)[1:]
    return {parts[i].strip(): parts[i + 1] for i in range(0, len(parts), 2)}


def steps_and_notes(body):
    """Numbered steps plus the bolded guidance lines that carry the routing
    decisions and the do-not-say warnings — those matter as much as the steps.

    Steps are gathered across continuation lines: several entries put figures
    the agent must quote exactly (the 259/218-character Office path limits, the
    Windows microphone toggles) in an indented sub-list under the step, and
    reading only the first line silently drops them."""
    steps = []
    for line in body.split("\n"):
        m = re.match(r"^\s*(\d+)\.\s+(.*)$", line)
        if m:
            steps.append(m.group(2).strip())
        elif steps and line.startswith((" ", "\t")) and line.strip():
            # Indented continuation of the step above.
            steps[-1] += " " + line.strip().lstrip("-* ")
        elif not line.strip():
            continue
        else:
            # A non-indented line ends the numbered list.
            if steps:
                break
    steps = [re.sub(r"\s+", " ", s).strip() for s in steps if s.strip()]
    if not steps:  # entries written as bullets rather than a numbered list
        steps = [re.sub(r"\s+", " ", s).strip()
                 for s in re.findall(r"^\s*[-*]\s+(.+)$", body, re.M)]
    notes = [re.sub(r"\s+", " ", n).strip()
             for n in re.findall(r"^\*\*(.+?)\*\*[:.]?\s*(.*)$", body, re.M)
             for n in [" ".join(x for x in n if x)]]
    return steps, notes


def main():
    entries = kb_entries()
    out = []
    for cid, heading, category, application, outcome, phrasings in CASES:
        if heading not in entries:
            raise SystemExit(f"KB has no entry '{heading}' for case {cid}")
        steps, notes = steps_and_notes(entries[heading])
        if not steps:
            raise SystemExit(f"no steps parsed for {cid} ({heading})")

        expected = (
            f"{outcome}\n\n"
            "EXPECTED STEPS — taken from the knowledge base entry the agent answers from. "
            "The agent should guide the caller through these in a sensible order, adapting "
            "to what the caller reports. It need not recite every step verbatim, but it must "
            "cover the substance and must not skip straight to escalation while simple steps "
            "remain untried: "
            + " ".join(f"{i}. {s}" for i, s in enumerate(steps, 1))
        )
        if notes:
            expected += "\n\nKB NOTES for this entry (these carry the routing decision and the "
            expected += "things the agent must not say): " + " | ".join(notes)
        if cid in WARM_TRANSFER:
            expected += ("\n\nThis case must end in a WARM TRANSFER — the caller stays on the "
                         "line and is handed live to an agent. Resolving it in-pathway, or "
                         "raising a ticket and letting the caller go, is a failure.")
        expected += f"\n\n{ESCALATION}\n\n{GUARDRAILS}"

        graders = [{"type": "contains", "any": ANCHORS[cid]}, dict(GUARDRAIL_GATE)]
        if cid == "bitlocker-recovery-key":
            graders.append({
                "type": "forbidden_regex", "pattern": r"\d{6}[- ]\d{6}", "flags": "i",
                "description": ("Agent must never read out anything shaped like a BitLocker "
                                "recovery key (six-digit groups); only the 8-digit identifier."),
            })
        graders.append({"type": "judge"})

        out.append({
            "id": cid, "name": heading, "category": category, "application": application,
            "expected": expected,
            "variants": [{"turns": [p]} for p in phrasings],
            "graders": graders,
        })

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"wrote {len(out)} cases -> {OUT}")
    print(f"variants: {sum(len(c['variants']) for c in out)}")


if __name__ == "__main__":
    main()
