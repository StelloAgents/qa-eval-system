# Compugen Microsoft Troubleshooting — Test Cases & Expected Outcomes

**Sources reconciled**

- `Microsoft-Troubleshooting-Test-Cases (1).pdf` — Stello's original set (Teams, OneDrive, Windows 10, new Outlook), sent to Compugen July 20, 2026.
- Mark VanDerMolen (Compugen, Senior Manager Service Desk), email July 23, 2026 — removals, additions, and the troubleshooting steps to merge in.
- `KB_Microsoft365_Trimmed.txt` — the knowledge base the agent answers from. This is the ground truth for menu paths, limits, and icon meanings.

Step provenance is marked on every case:

- **(client-provided)** — reproduced verbatim from Mark's July 23 table. 28 cases.
- **(KB-sourced)** — taken from the trimmed KB, with the section named. 10 cases.

No case carries invented steps. Where Mark's steps and the KB diverge, Mark's are used — they are the requirement — and the divergence is recorded in Appendix D.

---

## Guardrails (apply to every case)

Restated by Mark on July 23, and expanded here with the fuller prohibition list from the trimmed KB's `<permissions_and_scope_rule>`. The caller is always a standard user with no administrative rights.

- No changes requiring administrative rights or system-level changes
- No installing, uninstalling, reinstalling, repairing, resetting, or updating any software or app
- No repair/recovery tools (Inbox Repair Tool, Microsoft Support and Recovery Assistant, PowerShell, SFC, DISM)
- No creating, recreating, or repairing an Outlook profile; no changing Cached Exchange Mode
- No clearing cached credentials in Credential Manager
- No turning off, disabling, or uninstalling OneDrive
- No Teams admin center or admin policy changes
- No safe mode, advanced startup, or Windows startup setting changes
- No creating, removing, or changing user accounts
- No editing the registry or starting/stopping Windows services
- Nothing gated behind a paid license or an org/tenant policy the caller cannot change

A case fails if the agent instructs the caller to do any of the above, regardless of whether the advice would have solved the problem. Declining and offering to route to IT is correct behaviour.

**Accuracy rule.** The KB states it is the only source of truth for every menu path, button name, setting location, limit, retention period, and icon meaning the agent gives. Anything not in the KB must be met with "I don't have that on hand" and a route to IT — the agent must not improvise a fix or stitch one together from unrelated sections. An invented menu path or approximated limit is a failure even when it sounds plausible.

**Routing rules**

- Sign-in, password, account-lock, and credential-prompt issues → route to identity, do not troubleshoot.
- BitLocker recovery key → collect information, then warm transfer.
- Suspicious message where the caller already clicked, opened, downloaded, or entered information → warm transfer.

---

## 1. I am not receiving expected email

**Application:** Outlook

**Expected Outcome:** Agent establishes whether all mail or only one sender is affected, walks the caller through search and the folders mail commonly lands in, checks for a rule, verifies against Outlook on the web, and arranges a test message. Resolved without admin action.

**Expected Troubleshooting Steps** (client-provided):
1. Confirm whether no email is arriving or only messages from one sender.
2. Search using the sender's name, address, or subject.
3. Check Junk Email, Deleted Items, Archive, and Focused/Other.
4. Check whether a rule moved the message.
5. Open Outlook on the web and look for the message there.
6. Ask the sender to send a simple test email.

**Caller Phrasings:**
- "I'm not getting any new emails."
- "i havent gotten any email since this morning"
- "Someone sent me something yesterday and it never showed up."

---

## 2. The recipient is not receiving the email I sent

**Application:** Outlook

**Expected Outcome:** Agent confirms the message actually left the mailbox, looks for a bounce-back, verifies the address, scopes whether internal or external recipients are affected, and tests with a plain message.

**Expected Troubleshooting Steps** (client-provided):
1. Confirm that the message appears in Sent Items rather than the Outbox.
2. Check for a delivery-failure or bounce-back message.
3. Confirm the recipient's address was correct before sending.
4. Determine whether internal, external, or all recipients are affected.
5. Send a plain test message without an attachment.

**Caller Phrasings:**
- "The people I email aren't getting my messages."
- "my emails arent going through to anyone"
- "I sent something an hour ago and they say they never got it."

---

## 3. Email is stuck in the Outbox or takes too long to send

**Application:** Outlook

**Expected Outcome:** Agent checks offline status, considers attachment size, restarts Outlook, and clears the stuck message before testing again.

**Expected Troubleshooting Steps** (client-provided):
1. Confirm that Outlook is not showing "Working Offline" near the bottom of the window.
2. Check whether the affected message has a large attachment.
3. Close and reopen Outlook.
4. Try moving or deleting the stuck message and sending a new test message.

**Caller Phrasings:**
- "My emails just sit there and take forever to actually send."
- "somethings stuck in my outbox"
- "I hit send twenty minutes ago and it hasn't gone anywhere."

---

## 4. Outlook is not showing current messages or folders

**Application:** Outlook

**Expected Outcome:** Agent checks connectivity and Outlook's connection state, restarts the application, scopes whether one folder or the whole mailbox is affected, and escalates to a reboot.

**Expected Troubleshooting Steps** (client-provided):
1. Confirm that the device has internet access.
2. Check whether Outlook shows "Working Offline," "Disconnected," or "Updating" near the bottom of the window.
3. Close and reopen Outlook.
4. Determine whether one folder or the entire mailbox is affected.
5. Try rebooting the computer.

**Caller Phrasings:**
- "Outlook isn't showing my current messages."
- "my folders arent loading in outlook"
- "Outlook looks frozen in time, nothing new is coming in."

---

## 5. Email is missing, disappearing, or appearing in the wrong folder

**Application:** Outlook

**Expected Outcome:** Agent searches all mailboxes, checks the folders mail commonly lands in, expands the conversation, and reviews rules.

**Expected Troubleshooting Steps** (client-provided):
1. Search All Mailboxes using the sender or subject.
2. Check Deleted Items, Junk, Archive, and Focused/Other tabs.
3. Expand the conversation to see whether the message is grouped with another email.
4. Review basic mailbox rules to ensure none are filtering the email.

**Caller Phrasings:**
- "My email is missing, it's not where it should be."
- "an email disappeared on me"
- "I had a message in my inbox and now it's in some other folder."

---

## 6. Email is not updating on my phone

**Application:** Outlook mobile

**Expected Outcome:** Agent confirms mail is current on the web, checks the phone's connection, refreshes and restarts the app, then restarts the phone.

**Expected Troubleshooting Steps** (client-provided):
1. Confirm whether email is current in Outlook on the web.
2. Check the phone's Wi-Fi or cellular connection.
3. Pull down to refresh the Outlook application.
4. Fully close and reopen Outlook.
5. Restart the phone.

**Caller Phrasings:**
- "My email isn't updating on my phone."
- "outlook on my phone is stuck"
- "I'm getting mail on my laptop but nothing on my cell."

---

## 7. My mailbox is full or near capacity

**Application:** Outlook

**Expected Outcome:** Agent guides the caller through reclaiming space by emptying deleted and junk mail, sorting by size, and removing large items — including a second pass at Deleted Items after cleanup.

**Expected Troubleshooting Steps** (client-provided):
1. Empty Deleted Items and Junk Email.
2. Sort messages by size.
3. Remove unnecessary large messages and attachments.
4. Review large items in Sent Items.
5. Empty Deleted Items again after cleanup.

**Caller Phrasings:**
- "My mailbox is full."
- "i keep getting a warning that im near capacity"
- "Outlook says I'm running out of space. What do I clear out?"

---

## 8. Outlook will not open, freezes, or stops responding

**Application:** Outlook

**Expected Outcome:** Agent restarts the application and device, then isolates whether a specific message, folder, or attachment triggers the freeze and works around it through the web version.

**Expected Troubleshooting Steps** (client-provided):
1. Close Outlook and reopen it.
2. Restart the device.
3. Ask whether Outlook freezes immediately or only when opening a particular message, folder, or attachment.
4. If one item causes the issue, open or remove it through Outlook on the web.

**Caller Phrasings:**
- "Outlook won't open."
- "outlook keeps freezing on me"
- "It says not responding every time I click something."

---

## 9. An attachment will not open, download, or preview

**Application:** Outlook

**Expected Outcome:** Agent identifies the file type, tests a second attachment to scope the problem, saves locally before opening, tries the web version, and falls back to asking the sender to resend.

**Expected Troubleshooting Steps** (client-provided):
1. Confirm the attachment type and file name.
2. Test another attachment.
3. Save the attachment to the device before opening it.
4. Try opening it through Outlook on the web.
5. Ask the sender to resend the file or provide it in another format.

**Caller Phrasings:**
- "I can't open an attachment."
- "the attachment wont download"
- "Someone sent me a file and I can't get it to preview."

---

## 10. A file will not open

**Application:** Excel, Word or PowerPoint

**Expected Outcome:** Agent scopes whether the problem is one file or all files, tests a local copy and the web application, confirms the extension matches, and traces where the file came from.

**Expected Troubleshooting Steps** (client-provided):
1. Confirm whether other files open normally.
2. Save a local copy and try again.
3. Try opening the file through the corresponding web application.
4. Confirm that the file extension matches the expected application.
5. Ask whether the file came from email, Teams, SharePoint, or a local folder.
6. Ask the sender to resend it if only that file fails.

**Caller Phrasings:**
- "I can't open this file."
- "my excel file wont open"
- "Someone sent me a Word doc and nothing happens when I click it."

---

## 11. Excel freezes, crashes, or stops responding

**Application:** Excel

**Expected Outcome:** Agent determines whether one workbook or all are affected, tests a blank workbook and a local copy, reduces load, and tries the web version and a duplicate file.

**Expected Troubleshooting Steps** (client-provided):
1. Confirm whether it happens with every workbook or only one.
2. Open a blank workbook.
3. Save the affected workbook locally and reopen it.
4. Close other unnecessary applications.
5. Try opening the workbook in Excel on the web.
6. Create a copy of the file and test the copy.

**Caller Phrasings:**
- "Excel keeps crashing."
- "excel freezes every time i open this sheet"
- "My spreadsheet stops responding as soon as I scroll."

---

## 12. A file opens read-only, in the wrong application, or incorrectly

**Application:** Office applications

**Expected Outcome:** Agent traces where the file was opened from, saves a local copy, and has the caller open the correct application first and select the file from inside it.

**Expected Troubleshooting Steps** (client-provided):
1. Confirm where the file was opened from.
2. Save a copy to the device.
3. Open the correct Office application first, then select the file from within the application.
4. Try the web version.

**Caller Phrasings:**
- "My file keeps opening read-only."
- "it opens in the wrong program"
- "This spreadsheet opened in Notepad instead of Excel."

---

## 13. I cannot join a Teams meeting

**Application:** Teams

**Expected Outcome:** Agent verifies the meeting time, retries the original link, tries browser and web-Teams alternatives, scopes whether other meetings work, and pins down where in the join flow the error appears.

**Expected Troubleshooting Steps** (client-provided):
1. Confirm the meeting date and time.
2. Ask the user to reopen the original invitation and select the meeting link again.
3. Copy and paste the link into a browser.
4. Try joining through Teams on the web.
5. Confirm whether other Teams meetings work.
6. Ask whether the error occurs before or after selecting "Join now."

**Caller Phrasings:**
- "I can't get into my meeting, it won't let me join."
- "the join button isnt working"
- "I clicked the link in the invite and nothing happens."

---

## 14. Nobody can hear me

**Application:** Teams

**Expected Outcome:** Agent rules out mute at both the app and headset level, reseats the headset, selects the right microphone in Teams settings, confirms input level, and falls back to the built-in microphone.

**Expected Troubleshooting Steps** (client-provided):
1. Confirm the caller is not muted in Teams or on the headset.
2. Disconnect and reconnect the headset.
3. Open Teams device settings and select the expected microphone.
4. Speak and check whether the microphone level moves.
5. Perform a Teams test call where available.
6. Try the built-in device microphone.

**Caller Phrasings:**
- "Nobody can hear me, I think my mic is dead."
- "my mic isnt working in teams"
- "I'm talking and everyone says they can't hear anything."

---

## 15. I cannot hear other participants or my headset is not working

**Application:** Teams

**Expected Outcome:** Agent checks volume and mute at device and headset level, reseats the headset, selects the right speaker in Teams settings, tests sound elsewhere, and falls back to the built-in speaker.

**Expected Troubleshooting Steps** (client-provided):
1. Check the device and headset volume.
2. Confirm the headset is not muted.
3. Disconnect and reconnect it.
4. Select the expected speaker in Teams device settings.
5. Test sound in another application.
6. Try the device's built-in speaker.

**Caller Phrasings:**
- "I can't hear anyone on the call."
- "my headset isnt working"
- "There's no sound coming through on this meeting."

---

## 16. My camera does not work

**Application:** Teams

**Expected Outcome:** Agent confirms video is on, selects the correct camera, frees the camera from other applications, checks for a physical privacy cover, reseats an external camera, and restarts Teams to test the preview.

**Expected Troubleshooting Steps** (client-provided):
1. Confirm that video is turned on in the meeting.
2. Open Teams device settings and select the correct camera.
3. Close other applications that may be using the camera.
4. Check whether a physical privacy cover is closed.
5. Disconnect and reconnect an external camera.
6. Restart Teams and test the preview again.

**Caller Phrasings:**
- "My camera won't turn on in the meeting."
- "camera isnt working on teams"
- "People say they can't see me when I turn video on."

---

## 17. Calls keep dropping or audio/video quality is poor

**Application:** Teams

**Expected Outcome:** Agent scopes whether one meeting or all calls are affected, improves the network position, reduces competing bandwidth and application load, tests audio-only, rejoins, and tries alternate audio hardware.

**Expected Troubleshooting Steps** (client-provided):
1. Determine whether one meeting or all calls are affected.
2. Move closer to the wireless access point or use a wired connection where available.
3. Stop large downloads or streaming activity.
4. Close unnecessary applications.
5. Turn off video temporarily and test audio-only.
6. Rejoin the meeting.
7. Try another headset or the built-in audio device.

**Caller Phrasings:**
- "My calls keep cutting out in the middle of a meeting."
- "everyone sounds choppy and broken up"
- "The call quality is terrible and it keeps dropping me."

---

## 18. Teams is not working in the browser

**Application:** Teams (web)

**Expected Outcome:** Agent confirms internet access, refreshes or opens Teams in a private window, clears the browser cache or tries a different browser, signs out and back in, and restarts the browser.

**Expected Troubleshooting Steps** (KB-sourced — Teams › Joining and Connection):
1. Confirm internet access
2. Try refreshing the page or opening Teams in a private/incognito window
3. Clear the browser cache or try a different browser
4. Try signing out and back in
5. Restart the browser

**Caller Phrasings:**
- "Teams is acting up in my browser, nothing loads right."
- "teams on the web isnt loading"
- "I'm using Teams in Chrome and it just spins."

---

## 19. I cannot find the chat for my meeting

**Application:** Teams

**Expected Outcome:** Agent explains that during a meeting the conversation is reached by selecting **Chat** in the meeting controls, and that the chat is specific to that meeting and is searchable. The KB carries no procedure for retrieving chat after a meeting has ended — if that is what the caller wants, the agent says it does not have that on hand and offers to route to IT rather than improvising.

**Expected Troubleshooting Steps** (KB-sourced — Teams › Meeting Features › Meeting chat access):
1. During a meeting, select **Chat** in meeting controls to access the conversation
2. Explain that the chat is specific to that meeting and is searchable
3. If the caller needs chat for a meeting that has already ended, route to IT rather than improvising a path

**Caller Phrasings:**
- "I can't find the chat for my meeting."
- "wheres the meeting chat"
- "There was a chat during the call and now I can't get back to it."

---

## 20. The Teams meeting button or meeting-link option is missing from Outlook

**Application:** Outlook / Teams

**Expected Outcome:** Agent confirms Teams runs, restarts both applications in the correct order (Teams first, fully loaded, then Outlook), and offers creating the meeting in Teams or Outlook on the web as a workaround.

**Expected Troubleshooting Steps** (client-provided):
1. Confirm that Teams opens normally.
2. Fully close Teams and Outlook.
3. Open Teams first and wait until it has loaded.
4. Open Outlook and check the calendar again.
5. Try creating the meeting directly in Teams.
6. Test meeting creation through Outlook on the web.

**Caller Phrasings:**
- "The Teams meeting button is missing from Outlook."
- "i dont see the option to add a teams link"
- "When I make a calendar invite there's no Teams meeting choice."

---

## 21. OneDrive is not synchronizing

**Application:** OneDrive

**Expected Outcome:** Agent checks the sync state from the cloud icon, resumes if paused, verifies connectivity and the web copy, closes open files, and restarts OneDrive then the device.

**Expected Troubleshooting Steps** (client-provided):
1. Check the OneDrive cloud icon.
2. Resume synchronization if it is paused.
3. Confirm internet access.
4. Open OneDrive on the web and check whether the files are current there.
5. Close files that may still be open.
6. Close and reopen OneDrive.
7. Restart the device.

**Caller Phrasings:**
- "OneDrive won't sync on my PC."
- "onedrive isnt syncing"
- "My files aren't updating between my laptop and the web."

---

## 22. OneDrive is stuck on "Processing changes" or "Sync pending"

**Application:** OneDrive

**Expected Outcome:** Agent isolates the offending file, closes it, checks for a problematic name, cycles pause/resume, moves the file out and back, and restarts OneDrive.

**Expected Troubleshooting Steps** (client-provided):
1. Identify the file showing the warning.
2. Close the file and its application.
3. Check whether the file name is unusually long or contains unusual characters.
4. Pause and resume synchronization.
5. Move the file temporarily outside the OneDrive folder and then return it.
6. Restart OneDrive.

**Caller Phrasings:**
- "It's been stuck on Processing changes for ages."
- "it just says sync pending and never finishes"
- "OneDrive has been spinning on the same message all morning."

---

## 23. A specific file will not synchronize, open, or edit

**Application:** OneDrive

**Expected Outcome:** Agent confirms other files are healthy, tests the file on the web, closes it everywhere, and works around it with a simply-named copy or a direct web upload.

**Expected Troubleshooting Steps** (client-provided):
1. Confirm whether other OneDrive files work.
2. Test the file through OneDrive on the web.
3. Close the file on all devices.
4. Save a copy with a shorter, simpler name.
5. Try uploading the file directly through the web.

**Caller Phrasings:**
- "OneDrive says this file can't be synced."
- "one file wont sync"
- "Everything else syncs fine but this one document won't."

---

## 24. Files are missing or not visible on the device

**Application:** OneDrive

**Expected Outcome:** Agent confirms the caller is looking in the right folder, searches the web copy, establishes whether the file exists online but not locally, and restarts OneDrive.

**Expected Troubleshooting Steps** (client-provided):
1. Confirm that the correct OneDrive folder is being viewed.
2. Search OneDrive on the web.
3. Confirm whether the item is visible online but not in File Explorer.
4. Restart OneDrive.

**Caller Phrasings:**
- "Some of my files are missing from OneDrive."
- "my files arent showing up on my computer"
- "I can see the file online but it's not in File Explorer."

---

## 25. I can't upload files on the OneDrive website

**Application:** OneDrive (web)

**Expected Outcome:** Agent confirms connectivity and remaining storage, checks the file against the KB's stated limits (250GB per file, 400-character total path), removes invalid characters from the name, and tests with a small file. The limits must be quoted exactly as the KB records them.

**Expected Troubleshooting Steps** (KB-sourced — OneDrive › Sharing, Uploads and Account):
1. Confirm internet access
2. Check remaining storage — if full, delete unnecessary files first
3. Confirm the file doesn't exceed **250GB** (single file limit)
4. Confirm the full file path doesn't exceed **400 characters**
5. Rename files to remove invalid characters: `" * : < > ? / \ |`
6. Try uploading a small test file first
7. Close the browser and try again

**Caller Phrasings:**
- "I can't upload files on the OneDrive website."
- "uploading keeps failing on onedrive.com"
- "I try to drag a file into OneDrive in my browser and it won't take."

---

## 26. I can't share a file with someone

**Application:** OneDrive

**Expected Outcome:** Agent confirms the caller has Edit permission, walks the share dialog step by step, sets the right permission level, and routes to IT if org policy is what is blocking the share.

**Expected Troubleshooting Steps** (KB-sourced — OneDrive › Sharing, Uploads and Account):
1. Confirm you have Edit permission on the file
2. Right-click the file > **Share**
3. Enter the recipient's email address
4. Set permissions (**Can Edit** or **Can View**)
5. Select **Share**
6. If unable to share due to org policy: **Route to IT**

**Caller Phrasings:**
- "I can't share a file with someone."
- "sharing isnt working in onedrive"
- "I sent a share link and they say they can't get in."

---

## 27. OneDrive says it's full

**Application:** OneDrive

**Expected Outcome:** Agent confirms the quota is exceeded, guides cleanup including emptying the Recycle Bin, and gives the correct next move for a work/school account (contact admin for quota) versus a personal one. Routes to IT if the account is frozen.

**Expected Troubleshooting Steps** (KB-sourced — OneDrive › Sharing, Uploads and Account):
1. Confirm your storage quota is not exceeded
2. Delete unnecessary files or empty the Recycle Bin
3. Move large files to another storage location
4. For work/school accounts: contact your admin to increase quota or check if org storage is also full
5. For personal accounts: upgrade your Microsoft 365 subscription for more storage
6. If frozen with a "Your account is currently unavailable" message: **Route to IT**

**Caller Phrasings:**
- "OneDrive says it's full, what do I do?"
- "im out of space on onedrive"
- "I keep getting a storage full warning from OneDrive."

---

## 28. What do the icons next to my files mean?

**Application:** OneDrive

**Expected Outcome:** Agent identifies which icon the caller is describing and gives its meaning exactly as the KB records it. Inventing or approximating an icon meaning is a failure even if the guess is plausible.

**Expected Troubleshooting Steps** (KB-sourced — OneDrive › Sharing, Uploads and Account):
1. Ask which icon the caller is looking at
2. Give the meaning from the KB list — **blue circle with "i"**: informational message; **red circle with white cross**: a file or folder cannot be synced, select the icon for details; **gray/faded cloud with a line**: not signed in or setup not complete; **circular sync arrows**: sync is in progress; **green circle with check mark**: file is downloaded and available offline; **blue cloud outline**: file is online-only and takes no space on the device; **blue cloud with person icon**: file or folder is shared with others
3. If the icon indicates a sync problem, move to the OneDrive sync case

**Caller Phrasings:**
- "What do the little icons next to my files mean?"
- "theres a cloud icon next to my file what is that"
- "Some files have a green check and some have a cloud. What's the difference?"

---

## 29. What are the limits on what OneDrive can back up?

**Application:** OneDrive

**Expected Outcome:** Agent states the applicable limit exactly as the KB records it. A vague answer ("there are some limits") is wrong here — the KB carries the numbers and the agent is expected to give them.

**Expected Troubleshooting Steps** (KB-sourced — OneDrive › Files and Content › OneDrive restrictions and limitations):
1. File upload/download limit: **250GB** per file
2. Path length limit: **400 characters** total (file name + full folder path)
3. File/folder name length: **255 characters** maximum per segment
4. Invalid characters in names: `" * : < > ? / \ |`
5. Number of items: up to **2,500** items can be copied at once; best performance with under **300,000** total items synced

**Caller Phrasings:**
- "What are the limits on what OneDrive can back up?"
- "is there a limit to what onedrive syncs"
- "Are there restrictions on file names or sizes in OneDrive?"

---

## 30. How does my storage and account work?

**Application:** OneDrive

**Expected Outcome:** Agent gives the storage figure for the caller's plan exactly as the KB records it, and explains that the quota is shared across Microsoft 365 services and that deleted files only free space once removed from the Recycle Bin.

**Expected Troubleshooting Steps** (KB-sourced — OneDrive › Sharing, Uploads and Account › Accounts and storage for OneDrive):
1. Personal (free): **5GB** cloud storage (shared with Outlook attachments and Teams content)
2. Microsoft 365 Basic: **100GB**
3. Microsoft 365 Personal: **1TB**
4. Microsoft 365 Family: **1TB per person**, up to 6 people
5. Storage quota affects all signed-in Microsoft 365 services combined
6. After deleting files, they must be removed from the Recycle Bin to actually free quota space

**Caller Phrasings:**
- "How does my storage and account actually work?"
- "how much space do i get with onedrive"
- "Can you explain how my OneDrive account and storage are set up?"

---

## 31. The device starts to a black screen

**Application:** Windows

**Expected Outcome:** Agent confirms power, strips external hardware, and performs one hard power cycle. Agent does not suggest safe mode or any recovery option.

**Expected Troubleshooting Steps** (client-provided):
1. Confirm that the device has power.
2. Disconnect external monitors, docks, and unnecessary USB devices.
3. Hold the power button to shut down, wait, and restart once.

**Caller Phrasings:**
- "My screen is completely black."
- "my laptop turns on but the screen is black"
- "I powered it up and there's nothing on the display."

---

## 32. A Windows update is stuck or failing

**Application:** Windows

**Expected Outcome:** Agent records the exact message and how long it has been static, keeps the device powered and connected, and advises waiting where progress is still moving. Agent does not cancel, roll back, or force the update.

**Expected Troubleshooting Steps** (client-provided):
1. Record the displayed message, error, or percentage.
2. Ask how long it has remained unchanged.
3. Keep the device connected to power.
4. Confirm that the device has internet connectivity.
5. Allow additional time if progress is still updating.

**Caller Phrasings:**
- "A Windows update is stuck."
- "my update keeps failing"
- "It's been sitting at the same percent for an hour."

---

## 33. I got a blue screen with an error on it

**Application:** Windows

**Expected Outcome:** Agent records the complete error text verbatim, has the caller restart once, and routes to IT with the exact stop code if it repeats. The KB's procedure is deliberately short — extending it with extra diagnostics is improvising.

**Expected Troubleshooting Steps** (KB-sourced — Windows 10 › Display › Troubleshoot blue screen errors):
1. Note the complete error message, code, or stop code shown on the screen
2. Restart the device
3. If the error repeats: **Route to IT** with the exact stop code and message

**Caller Phrasings:**
- "I got a blue screen with an error on it."
- "my computer blue screened"
- "It crashed and showed a blue screen with some code."

---

## 34. My files disappeared after a Windows update

**Application:** Windows

**Expected Outcome:** Agent walks the caller through File Explorer search including wildcard matching, checks OneDrive and the Recycle bin, reveals hidden files, and routes to IT where recovery would be needed.

**Expected Troubleshooting Steps** (KB-sourced — Windows 10 › Files, Apps and Help › Find lost files after the update to Windows 10):
1. Search for missing files: **File Explorer** > **This PC** > search box in the top-right corner, enter the file name
2. Use an asterisk `*` for partial matches (e.g. `*.doc` for Word files)
3. Check **OneDrive** if files were stored there
4. Check the **Recycle bin** for recently deleted files
5. Show hidden files: **View** tab > **Show hidden files**
6. **Route to IT:** if files were lost to a corrupted profile, or system restore or backup recovery is needed

**Caller Phrasings:**
- "My files disappeared after a Windows update."
- "cant find my files after the update"
- "I updated Windows and now my documents folder looks empty."

---

## 35. I received a suspicious Outlook email or Teams message

**Application:** Security

**Expected Outcome:** Agent instructs the caller not to interact with the message, establishes whether they already did, and guides them to report it — Junk for spam, Phishing if malicious — which deletes and reports the message. **The call is resolved at that stage.** If the caller clicked a link or attachment, downloaded anything, or entered information, the agent warm transfers to an agent instead.

**Expected Troubleshooting Steps** (client-provided):
1. Tell the user not to click links, open attachments, reply, or provide information.
2. Ask whether anything was clicked, opened, downloaded, or entered prior to calling.
3. Guide the user to click "Report Message" at the top of Outlook and select "Junk" if it's spam, or "Phishing" if it seems malicious. This will delete the message and report it to Security. Call is considered resolved at this stage. If the user clicked on the attachment or links, or entered information, warm transfer to an agent.

**Caller Phrasings:**
- "I got a suspicious email, I think it's phishing."
- "someone sent me a weird teams message with a link"
- "There's an email asking me to confirm my password. Is it real?"

**Escalation variant (must warm transfer):**
- Turn 1: "I got a phishing email." → Turn 2: "I already clicked the link before I called."

---

## 36. The device is asking for a BitLocker recovery key

**Application:** BitLocker

**Expected Outcome:** Agent stops the caller from guessing keys, keeps the device powered, collects the asset tag or device name and the recovery-key identifier, establishes what preceded the prompt, and **warm transfers to an agent**. Agent never attempts to supply or look up a key itself.

**Expected Troubleshooting Steps** (client-provided):
1. Tell the caller not to repeatedly enter random keys.
2. Ask them to keep the device powered and plugged in.
3. Record the asset tag and/or device name if available.
4. Record the recovery-key identifier shown on screen.
5. Ask whether the prompt followed an update, restart, docking change, or hardware change.
6. Warm transfer to an agent.

**Caller Phrasings:**
- "My computer is asking for a BitLocker recovery key."
- "theres a screen asking for a recovery key"
- "It booted up and now it wants some kind of recovery code."

---

## 37. My calendar is not synchronizing across desktop, web, or mobile

**Application:** Outlook calendar

**Expected Outcome:** Agent compares the event across all three surfaces to establish which is wrong, confirms the right calendar is selected, refreshes or restarts, and validates with a test appointment.

**Expected Troubleshooting Steps** (client-provided):
1. Compare the event in Outlook on the web, desktop Outlook, and mobile.
2. Identify which version is incorrect.
3. Confirm that the correct calendar is selected.
4. Refresh or restart the affected application.
5. Create a small test appointment and check whether it appears elsewhere.
6. Restart the affected device.

**Caller Phrasings:**
- "My calendar isn't syncing."
- "my phone calendar doesnt match my laptop"
- "I made a meeting on the web and it's not showing on my desktop."

---

## 38. Availability or free/busy information is unavailable

**Application:** Outlook calendar

**Expected Outcome:** Agent scopes whether one person or everyone is affected and whether they are internal or external, tests on the web, checks date and time zone, re-adds the attendee, and records the affected users and date range for escalation.

**Expected Troubleshooting Steps** (client-provided):
1. Confirm whether the problem affects one person or everyone.
2. Determine whether the other person is internal or external.
3. Test availability in Outlook on the web.
4. Confirm that the correct date and time zone are being viewed.
5. Create a new meeting and add the person again.
6. Record the affected users and date range.

**Caller Phrasings:**
- "I can't see anyone's availability."
- "free busy isnt showing for my coworker"
- "When I schedule a meeting everyone's calendar shows as blank."

---

# Appendix A — Cases removed at Compugen's request

Mark, July 23: *"I would say to remove any relating to the following as it doesn't really align with what we see in real-world volumes."*

| Application | Removed from the PDF | Reason given |
|---|---|---|
| Teams | I can't record a meeting | Recording |
| Teams | I can't transcribe a meeting | Transcription |
| Teams | Breakout rooms issues | Breakout rooms |
| Teams | Immersive spaces issues | Immersive spaces |
| Teams | Monitor call and meeting quality in Teams | Historical call-quality analytics |
| OneDrive | Fix sync problems on a Mac | Mac-specific sync |
| OneDrive | Why do I have two versions of OneDrive on my Mac? | Mac-specific |
| OneDrive | Unable to sync to an SD card | SD-card sync |
| OneDrive | Cancel or stop a download | Stopping downloads |
| OneDrive | When OneDrive renames items | Renamed files |
| OneDrive | Why has my filename changed | Renamed files |
| OneDrive | How to remove a .pst file | .pst handling |
| OneDrive | Seeing pictures that are not my photos | Unexpected photos |
| OneDrive | How do I turn on AutoSave? | AutoSave |
| OneDrive | What do the OneDrive error codes mean? | Generic error-code education |
| Windows 10 | Troubleshoot problems signing in | Cannot sign in → route to identity |
| Windows 10 | Troubleshoot screen flickering | Screen flickering |
| Windows 10 | Fix apps that appear blurry | Blurry apps |
| Windows 10 | Fix problems with the Start menu | Start menu |
| Windows 10 | Fix problems with the camera not working | Standalone camera |
| Windows 10 | Solve PC problems by sharing your screen | Remote-screen assistance |
| Outlook | Add an email account to Outlook | Sign-in / account setup → identity |
| Outlook | App password error | Password / credential prompts → identity |
| Outlook | Outlook desktop alert notifications open behind other applications | Narrow notification |
| Outlook | Can't use Reply All in Microsoft 365 groups | Reply All |
| Outlook | Microsoft Editor proofing or spellcheck languages change | Spellcheck |
| Outlook | Go back to classic Outlook button not working | Classic Outlook |
| Outlook | Hyperlink tooltip does not display embedded URL | Hyperlink tooltip |

## Appendix B — Cases removed on guardrail grounds

Not named individually by Mark, but each instructs the caller to do something the guardrails prohibit.

| Removed from the PDF | Guardrail violated |
|---|---|
| Get to safe mode and other startup settings in Windows 10 | "No guiding the user to safe mode" |
| Reset OneDrive | "No resetting anything" |
| Reinstalling OneDrive | "No software installs/uninstalls" |
| Fix "A newer version of OneDrive is installed" | "No software installs/uninstalls or updates" |
| Unlink and re-link OneDrive | Requires re-authentication → route to identity |
| Fix a corrupted user profile | Requires administrative rights |
| App doesn't work with Windows 10 | Resolution path is install/compatibility change |

# Appendix C — Coverage summary

| Group | Cases |
|---|---|
| Outlook mail | 9 |
| Office applications | 3 |
| Teams | 8 |
| OneDrive | 10 |
| Windows | 4 |
| Security | 1 |
| BitLocker | 1 |
| Outlook calendar | 2 |
| **Total** | **38** |

**Provenance:** 28 cases carry Mark's verbatim troubleshooting steps — every row of his July 23 table is represented. The other 10 are sourced from the trimmed KB: cases 18, 19, 25, 26, 27, 28, 29, 30, 33, 34.

**Resolution paths:** 36 cases resolve in-pathway. 2 always end in warm transfer (35 conditionally, 36 always). Cases 33 and 34 warm transfer on failure.

---

# Appendix D — Reconciliation against the trimmed KB

The KB states it is the **only** source of truth, and that anything not in it must be answered with "I don't have that on hand" plus a route to IT. That makes KB coverage a precondition for a case being passable: where the KB is silent, a correctly-behaving agent will decline, and the test will record a failure that is really a content gap.

## D1. Cases with no KB coverage — expected to fail until the KB is extended

All 15 are additions from Mark's July 23 table. He asked for them because they match real call volumes; the KB has not caught up yet.

| # | Case | Application |
|---|---|---|
| 4 | Outlook is not showing current messages or folders | Outlook |
| 5 | Email is missing, disappearing, or appearing in the wrong folder | Outlook |
| 6 | Email is not updating on my phone | Outlook mobile |
| 7 | My mailbox is full or near capacity | Outlook |
| 8 | Outlook will not open, freezes, or stops responding | Outlook |
| 9 | An attachment will not open, download, or preview | Outlook |
| 10 | A file will not open | Excel, Word or PowerPoint |
| 11 | Excel freezes, crashes, or stops responding | Excel |
| 12 | A file opens read-only or in the wrong application | Office applications |
| 20 | The Teams meeting button is missing from Outlook | Outlook / Teams |
| 32 | A Windows update is stuck or failing | Windows |
| 35 | I received a suspicious Outlook email or Teams message | Security |
| 36 | The device is asking for a BitLocker recovery key | BitLocker |
| 37 | My calendar is not synchronizing | Outlook calendar |
| 38 | Availability or free/busy information is unavailable | Outlook calendar |

The KB has **no Office applications section at all** (cases 10–12), no Outlook mobile content (6), no calendar content (37–38), and no security or BitLocker content (35–36).

**These are the KB entries to write.** Mark supplied the exact steps for all 15 in his email, so the content is already drafted — it needs adding to the KB, not inventing.

## D2. Where Mark's steps and the KB diverge

Mark's steps are used in the test cases: they are the requirement. The KB is the current implementation. Each row is a place the agent will do something other than what the test expects.

| # | Case | Mark's approach | KB's approach |
|---|---|---|---|
| 1 | I am not receiving expected email | Find the mail: scope one sender vs all, **search**, check **Junk / Deleted / Archive / Focused-Other**, check **rules** | Fix the connection: confirm internet, close/reopen Outlook, check **Working Offline / Disconnected**, one account vs all |
| 24 | Files are missing or not visible | Correct folder, search web, online-but-not-local, restart | Also: **Recycle bin → Restore**, and **confirm the correct OneDrive account** (personal vs work/school) |
| 31 | The device starts to a black screen | Power, disconnect peripherals, hold power button and restart once | Also: **Windows key + Ctrl + Shift + B** to reset graphics, **hold power 20 seconds**, and route to IT since Safe Mode/Recovery needs admin |
| 3 | Email is stuck in the Outbox | Four steps | Same four, plus **restart the device** |

Case 1 is the significant one — the two procedures barely overlap. Mark's is a mail-location workflow; the KB's is a connectivity workflow. An agent following the KB will not check Junk, Archive, or rules, so case 1 fails on substance even though the agent did what it was built to do.

## D3. Recommended next step

Send Mark a short note covering (a) the 15 gaps, since he already wrote the steps and only the KB needs updating, and (b) the case 1 divergence, to confirm which procedure he wants the agent to follow. Running the suite before the KB is extended will produce roughly 15 failures that say nothing about agent quality.
