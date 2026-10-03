"""Builds the "拼豆读笔记" iOS Shortcut: from a Xiaohongshu share, fetch the note page as a phone
browser would and copy its source to the clipboard, for the app's "粘贴快捷指令结果".

    python3 build.py
    shortcuts sign -m anyone -i 拼豆读笔记.unsigned.shortcut -o ../app/public/拼豆读笔记.shortcut

Signing needs a Mac signed in to iCloud; the signed file carries only Apple's certificates.
"""
import plistlib
import uuid

PHONE = ('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 '
         '(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')


def text(s):
    return {'Value': {'string': s}, 'WFSerializationType': 'WFTextTokenString'}


def output(uid, name):
    return {'Value': {'Type': 'ActionOutput', 'OutputUUID': uid, 'OutputName': name},
            'WFSerializationType': 'WFTextTokenAttachment'}


def in_text(uid, name):
    """an action's output placed in a text field"""
    return {'Value': {'string': '￼', 'attachmentsByRange': {
        '{0, 1}': {'Type': 'ActionOutput', 'OutputUUID': uid, 'OutputName': name}}},
        'WFSerializationType': 'WFTextTokenString'}


ids = [str(uuid.uuid4()).upper() for _ in range(6)]
links, first, page, named, source, _ = ids
actions = [
    # the link in what was shared (share text or URL)
    {'WFWorkflowActionIdentifier': 'is.workflow.actions.detect.link', 'WFWorkflowActionParameters': {
        'UUID': links, 'WFInput': {'Value': {'Type': 'ExtensionInput'}, 'WFSerializationType': 'WFTextTokenAttachment'}}},
    {'WFWorkflowActionIdentifier': 'is.workflow.actions.getitemfromlist', 'WFWorkflowActionParameters': {
        'UUID': first, 'WFInput': output(links, 'URLs'), 'WFItemSpecifier': 'First Item'}},
    # the note page, asked for as a phone browser (a desktop one is sent to the login page)
    {'WFWorkflowActionIdentifier': 'is.workflow.actions.downloadurl', 'WFWorkflowActionParameters': {
        'UUID': page, 'WFURL': in_text(first, 'Item from List'), 'WFHTTPMethod': 'GET', 'ShowHeaders': True,
        'WFHTTPHeaders': {'Value': {'WFDictionaryFieldValueItems': [
            {'WFItemType': 0, 'WFKey': text('User-Agent'), 'WFValue': text(PHONE)}]},
            'WFSerializationType': 'WFDictionaryFieldValue'}}},
    # named as a text file, so it is read as source rather than as a rendered web page
    {'WFWorkflowActionIdentifier': 'is.workflow.actions.setitemname', 'WFWorkflowActionParameters': {
        'UUID': named, 'WFInput': output(page, 'Contents of URL'), 'WFName': text('note.txt')}},
    {'WFWorkflowActionIdentifier': 'is.workflow.actions.detect.text', 'WFWorkflowActionParameters': {
        'UUID': source, 'WFInput': output(named, 'Renamed Item')}},
    {'WFWorkflowActionIdentifier': 'is.workflow.actions.setclipboard', 'WFWorkflowActionParameters': {
        'WFInput': output(source, 'Text')}},
    {'WFWorkflowActionIdentifier': 'is.workflow.actions.notification', 'WFWorkflowActionParameters': {
        'WFNotificationActionTitle': text('拼豆读笔记'),
        'WFNotificationActionBody': text('已复制。回到拼豆 App，在"＋"里点「粘贴快捷指令结果」。'),
        'WFNotificationActionSound': False}},
]

shortcut = {
    'WFWorkflowClientVersion': '2605.0.5',
    'WFWorkflowMinimumClientVersion': 900,
    'WFWorkflowMinimumClientVersionString': '900',
    'WFWorkflowIcon': {'WFWorkflowIconStartColor': 4271458815, 'WFWorkflowIconGlyphNumber': 59511},
    'WFWorkflowTypes': ['ActionExtension'],
    'WFWorkflowInputContentItemClasses': ['WFURLContentItem', 'WFStringContentItem'],
    'WFWorkflowImportQuestions': [],
    # run from the home screen or the app (not the share sheet): read the link copied in Xiaohongshu
    'WFWorkflowNoInputBehavior': {'Name': 'WFWorkflowNoInputBehaviorGetClipboard', 'Parameters': {}},
    'WFWorkflowActions': actions,
}

with open('拼豆读笔记.unsigned.shortcut', 'wb') as f:
    plistlib.dump(shortcut, f, fmt=plistlib.FMT_BINARY)
