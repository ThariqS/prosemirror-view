var ref = require("prosemirror-state");
var Selection = ref.Selection;
var NodeSelection = ref.NodeSelection;
var TextSelection = ref.TextSelection;

var browser = require("./browser")
var ref$1 = require("./capturekeys");
var captureKeyDown = ref$1.captureKeyDown;
var ref$2 = require("./domchange");
var DOMChange = ref$2.DOMChange;
var ref$3 = require("./clipboard");
var fromClipboard = ref$3.fromClipboard;
var toClipboard = ref$3.toClipboard;
var canUpdateClipboard = ref$3.canUpdateClipboard;
var ref$4 = require("./trackmappings");
var TrackMappings = ref$4.TrackMappings;

// A collection of DOM events that occur within the editor, and callback functions
// to invoke when the event fires.
var handlers = {}, editHandlers = {}

function initInput(view) {
  view.shiftKey = false
  view.mouseDown = null
  view.dragging = null
  view.inDOMChange = null
  view.mutationObserver = window.MutationObserver &&
    new window.MutationObserver(function (mutations) { return registerMutations(view, mutations); })
  startObserving(view)

  var loop = function ( event ) {
    var handler = handlers[event]
    view.content.addEventListener(event, function (event) {
      if (eventBelongsToView(view, event) && !runCustomHandler(view, event) &&
          (view.editable || !(event.type in editHandlers)))
        { handler(view, event) }
    })
  };

  for (var event in handlers) loop( event );
  view.extraHandlers = Object.create(null)
  ensureListeners(view)
}
exports.initInput = initInput

function destroyInput(view) {
  stopObserving(view)
  if (view.inDOMChange) { view.inDOMChange.destroy() }
  if (view.dragging) { view.dragging.destroy() }
}
exports.destroyInput = destroyInput

function ensureListeners(view) {
  view.someProp("handleDOMEvents", function (handlers) {
    for (var type in handlers) { if (!view.extraHandlers[type] && !handlers.hasOwnProperty(type)) {
      view.extraHandlers[type] = true
      view.content.addEventListener(type, function (event) { return runCustomHandler(view, event); })
    } }
  })
}
exports.ensureListeners = ensureListeners

function runCustomHandler(view, event) {
  return view.someProp("handleDOMEvents", function (handlers) {
    var handler = handlers[event.type]
    return handler ? handler(view, event) : false
  })
}

function eventBelongsToView(view, event) {
  if (!event.bubbles) { return true }
  if (event.defaultPrevented) { return false }
  for (var node = event.target; node != view.content; node = node.parentNode)
    { if (!node || node.nodeType == 11 ||
        (node.pmViewDesc && node.pmViewDesc.stopEvent(event)))
      { return false } }
  return true
}

function dispatchEvent(view, event) {
  if (!runCustomHandler(view, event) && handlers[event.type] &&
      (view.editable || !(event.type in editHandlers)))
    { handlers[event.type](view, event) }
}
exports.dispatchEvent = dispatchEvent

editHandlers.keydown = function (view, event) {
  if (event.keyCode == 16) { view.shiftKey = true }
  if (view.inDOMChange) { return }
  if (view.someProp("handleKeyDown", function (f) { return f(view, event); }) || captureKeyDown(view, event))
    { event.preventDefault() }
  else
    { view.selectionReader.poll() }
}

editHandlers.keyup = function (view, e) {
  if (e.keyCode == 16) { view.shiftKey = false }
}

editHandlers.keypress = function (view, event) {
  if (view.inDOMChange || !event.charCode ||
      event.ctrlKey && !event.altKey || browser.mac && event.metaKey) { return }

  if (view.someProp("handleKeyPress", function (f) { return f(view, event); })) {
    event.preventDefault()
    return
  }

  var ref = view.state.selection;
  var node = ref.node;
  var $from = ref.$from;
  var $to = ref.$to;
  if (node || !$from.sameParent($to)) {
    var text = String.fromCharCode(event.charCode)
    if (!view.someProp("handleTextInput", function (f) { return f(view, $from.pos, $to.pos, text); }))
      { view.dispatch(view.state.tr.insertText(text).scrollIntoView()) }
    event.preventDefault()
  }
}

function eventCoords(event) { return {left: event.clientX, top: event.clientY} }

var lastClick = {time: 0, x: 0, y: 0}, oneButLastClick = lastClick

function isNear(event, click) {
  var dx = click.x - event.clientX, dy = click.y - event.clientY
  return dx * dx + dy * dy < 100
}

function runHandlerOnContext(view, propName, pos, inside, event) {
  if (inside == -1) { return false }
  var $pos = view.state.doc.resolve(inside)
  var loop = function ( i ) {
    if (view.someProp(propName, function (f) { return i > $pos.depth ? f(view, pos, $pos.nodeAfter, $pos.before(i), event, true)
                                                    : f(view, pos, $pos.node(i), $pos.before(i), event, false); }))
      { return { v: true } }
  };

  for (var i = $pos.depth + 1; i > 0; i--) {
    var returned = loop( i );

    if ( returned ) return returned.v;
  }
  return false
}

function updateSelection(view, selection, origin) {
  view.focus()
  var tr = view.state.tr.setSelection(selection)
  if (origin == "pointer") { tr.setMeta("pointer", true) }
  view.dispatch(tr)
}

function selectClickedLeaf(view, inside) {
  if (inside == -1) { return false }
  var $pos = view.state.doc.resolve(inside), node = $pos.nodeAfter
  if (node && node.isLeaf && NodeSelection.isSelectable(node)) {
    updateSelection(view, new NodeSelection($pos), "pointer")
    return true
  }
  return false
}

function selectClickedNode(view, inside) {
  if (inside == -1) { return false }
  var ref = view.state.selection;
  var selectedNode = ref.node;
  var $from = ref.$from;
  var selectAt

  var $pos = view.state.doc.resolve(inside)
  for (var i = $pos.depth + 1; i > 0; i--) {
    var node = i > $pos.depth ? $pos.nodeAfter : $pos.node(i)
    if (NodeSelection.isSelectable(node)) {
     if (selectedNode && $from.depth > 0 &&
          i >= $from.depth && $pos.before($from.depth + 1) == $from.pos)
        { selectAt = $pos.before($from.depth) }
      else
        { selectAt = $pos.before(i) }
      break
    }
  }

  if (selectAt != null) {
    updateSelection(view, NodeSelection.create(view.state.doc, selectAt), "pointer")
    return true
  } else {
    return false
  }
}

function handleSingleClick(view, pos, inside, event, selectNode) {
  return runHandlerOnContext(view, "handleClickOn", pos, inside, event) ||
    view.someProp("handleClick", function (f) { return f(view, pos, event); }) ||
    (selectNode ? selectClickedNode(view, inside) : selectClickedLeaf(view, inside))
}

function handleDoubleClick(view, pos, inside, event) {
  return runHandlerOnContext(view, "handleDoubleClickOn", pos, inside, event) ||
    view.someProp("handleDoubleClick", function (f) { return f(view, pos, event); })
}

function handleTripleClick(view, pos, inside, event) {
  return runHandlerOnContext(view, "handleTripleClickOn", pos, inside, event) ||
    view.someProp("handleTripleClick", function (f) { return f(view, pos, event); }) ||
    defaultTripleClick(view, inside)
}

function defaultTripleClick(view, inside) {
  var doc = view.state.doc
  if (inside == -1) {
    if (doc.isTextblock) {
      updateSelection(view, TextSelection.create(doc, 0, doc.content.size), "pointer")
      return true
    }
    return false
  }

  var $pos = doc.resolve(inside)
  for (var i = $pos.depth + 1; i > 0; i--) {
    var node = i > $pos.depth ? $pos.nodeAfter : $pos.node(i)
    var nodePos = $pos.before(i)
    if (node.isTextblock)
      { updateSelection(view, TextSelection.create(doc, nodePos + 1, nodePos + 1 + node.content.size), "pointer") }
    else if (NodeSelection.isSelectable(node))
      { updateSelection(view, NodeSelection.create(doc, nodePos), "pointer") }
    else
      { continue }
    return true
  }
}

function forceDOMFlush(view) {
  if (!view.inDOMChange) { return false }
  view.inDOMChange.finish(true)
  return true
}

var selectNodeModifier = browser.mac ? "metaKey" : "ctrlKey"

handlers.mousedown = function (view, event) {
  var flushed = forceDOMFlush(view)
  var now = Date.now(), type
  if (now - lastClick.time >= 500 || !isNear(event, lastClick) || event[selectNodeModifier]) { type = "singleClick" }
  else if (now - oneButLastClick.time >= 600 || !isNear(event, oneButLastClick)) { type = "doubleClick" }
  else { type = "tripleClick" }
  oneButLastClick = lastClick
  lastClick = {time: now, x: event.clientX, y: event.clientY}

  var pos = view.posAtCoords(eventCoords(event))
  if (!pos) { return }

  if (type == "singleClick")
    { view.mouseDown = new MouseDown(view, pos, event, flushed) }
  else if ((type == "doubleClick" ? handleDoubleClick : handleTripleClick)(view, pos.pos, pos.inside, event))
    { event.preventDefault() }
  else
    { view.selectionReader.poll("pointer") }
}

var MouseDown = function(view, pos, event, flushed) {
  var this$1 = this;

  this.view = view
  this.pos = pos
  this.flushed = flushed
  this.selectNode = event[selectNodeModifier]
  this.allowDefault = event.shiftKey

  var targetNode, targetPos
  if (pos.inside > -1) {
    targetNode = view.state.doc.nodeAt(pos.inside)
    targetPos = pos.inside
  } else {
    var $pos = view.state.doc.resolve(pos.pos)
    targetNode = $pos.parent
    targetPos = $pos.depth ? $pos.before() : 0
  }

  this.mightDrag = (targetNode.type.spec.draggable || targetNode == view.state.selection.node) ? {node: targetNode, pos: targetPos} : null
  this.target = flushed ? null : event.target
  if (this.target && this.mightDrag) {
    stopObserving(this.view)
    this.target.draggable = true
    if (browser.gecko && (this.setContentEditable = !this.target.hasAttribute("contentEditable")))
      { setTimeout(function () { return this$1.target.setAttribute("contentEditable", "false"); }, 20) }
    startObserving(this.view)
  }

  view.root.addEventListener("mouseup", this.up = this.up.bind(this))
  view.root.addEventListener("mousemove", this.move = this.move.bind(this))
  view.selectionReader.poll("pointer")
};

MouseDown.prototype.done = function () {
  this.view.root.removeEventListener("mouseup", this.up)
  this.view.root.removeEventListener("mousemove", this.move)
  if (this.mightDrag && this.target) {
    stopObserving(this.view)
    this.target.draggable = false
    if (browser.gecko && this.setContentEditable)
      { this.target.removeAttribute("contentEditable") }
    startObserving(this.view)
  }
};

MouseDown.prototype.up = function (event) {
  this.done()

  if (!this.view.content.contains(event.target.nodeType == 3 ? event.target.parentNode : event.target))
    { return }

  if (this.allowDefault) {
    this.view.selectionReader.poll("pointer")
  } else if (handleSingleClick(this.view, this.pos.pos, this.pos.inside, event, this.selectNode)) {
    event.preventDefault()
  } else if (this.flushed) {
    updateSelection(this.view, Selection.near(this.view.state.doc.resolve(this.pos.pos)), "pointer")
    event.preventDefault()
  } else {
    this.view.selectionReader.poll("pointer")
  }
};

MouseDown.prototype.move = function (event) {
  if (!this.allowDefault && (Math.abs(this.x - event.clientX) > 4 ||
                             Math.abs(this.y - event.clientY) > 4))
    { this.allowDefault = true }
  this.view.selectionReader.poll("pointer")
};

handlers.touchdown = function (view) {
  forceDOMFlush(view)
  view.selectionReader.poll("pointer")
}

handlers.contextmenu = function (view, e) {
  forceDOMFlush(view)
  var pos = view.posAtCoords(eventCoords(e))
  if (pos && view.someProp("handleContextMenu", function (f) { return f(view, pos.pos, e); }))
    { e.preventDefault() }
}

// Input compositions are hard. Mostly because the events fired by
// browsers are A) very unpredictable and inconsistent, and B) not
// cancelable.
//
// ProseMirror has the problem that it must not update the DOM during
// a composition, or the browser will cancel it. What it does is keep
// long-running operations (delayed DOM updates) when a composition is
// active.
//
// We _do not_ trust the information in the composition events which,
// apart from being very uninformative to begin with, is often just
// plain wrong. Instead, when a composition ends, we parse the dom
// around the original selection, and derive an update from that.

editHandlers.compositionstart = editHandlers.compositionupdate = function (view) {
  DOMChange.start(view, true)
  if (view.state.storedMarks) { view.inDOMChange.finish(true) }
}

editHandlers.compositionend = function (view, e) {
  if (!view.inDOMChange) {
    // We received a compositionend without having seen any previous
    // events for the composition. If there's data in the event
    // object, we assume that it's a real change, and start a
    // composition. Otherwise, we just ignore it.
    if (e.data) { DOMChange.start(view, true) }
    else { return }
  }

  view.inDOMChange.compositionEnd()
}

var observeOptions = {childList: true, characterData: true, attributes: true, subtree: true}

function startObserving(view) {
  if (view.mutationObserver)
    { view.mutationObserver.observe(view.content, observeOptions) }
  // IE11 has very broken mutation observers, so we also listen to DOMCharacterDataModified
  if (browser.ie && browser.ie_version <= 11)
    { view.content.addEventListener("DOMCharacterDataModified", view.onCharData || (view.onCharData = function (e) {
      registerMutation(view, {target: e.target, type: "characterData"})
    })) }
}
exports.startObserving = startObserving

function flushObserver(view) {
  if (view.mutationObserver) { registerMutations(view, view.mutationObserver.takeRecords()) }
}
exports.flushObserver = flushObserver

function stopObserving(view) {
  if (view.mutationObserver) {
    flushObserver(view)
    view.mutationObserver.disconnect()
  }
  if (browser.ie && browser.ie_version <= 11)
    { view.content.removeEventListener("DOMCharacterDataModified", view.onCharData) }
}
exports.stopObserving = stopObserving

function registerMutations(view, mutations) {
  if (view.editable) { for (var i = 0; i < mutations.length; i++)
    { registerMutation(view, mutations[i]) } }
}

function registerMutation(view, mut) {
  var desc = view.docView.nearestDesc(mut.target)
  if (mut.type == "attributes" &&
      (desc == view.docView || mut.attributeName == "contenteditable")) { return }
  if (!desc || desc.ignoreMutation(mut)) { return }

  var from, to
  if (mut.type == "childList") {
    var fromOffset = mut.previousSibling && mut.previousSibling.parentNode == mut.target
        ? Array.prototype.indexOf.call(mut.target.childNodes, mut.previousSibling) + 1 : 0
    if (fromOffset == -1) { return }
    from = desc.localPosFromDOM(mut.target, fromOffset, -1)
    var toOffset = mut.nextSibling && mut.nextSibling.parentNode == mut.target
        ? Array.prototype.indexOf.call(mut.target.childNodes, mut.nextSibling) : mut.target.childNodes.length
    if (toOffset == -1) { return }
    to = desc.localPosFromDOM(mut.target, toOffset, 1)
  } else if (mut.type == "attributes") {
    from = desc.posAtStart - desc.border
    to = desc.posAtEnd + desc.border
  } else { // "characterData"
    from = desc.posAtStart
    to = desc.posAtEnd
  }

  DOMChange.start(view).addRange(from, to)
}

editHandlers.input = function (view) { return DOMChange.start(view); }

handlers.copy = editHandlers.cut = function (view, e) {
  var sel = view.state.selection, cut = e.type == "cut"
  if (sel.empty) { return }
  if (!e.clipboardData || !canUpdateClipboard(e.clipboardData)) {
    if (cut && browser.ie && browser.ie_version <= 11) { DOMChange.start(view) }
    return
  }
  toClipboard(view, sel, e.clipboardData)
  e.preventDefault()
  if (cut) { view.dispatch(view.state.tr.deleteRange(sel.from, sel.to).scrollIntoView()) }
}

function sliceSingleNode(slice) {
  return slice.openLeft == 0 && slice.openRight == 0 && slice.content.childCount == 1 ? slice.content.firstChild : null
}

editHandlers.paste = function (view, e) {
  if (!e.clipboardData) {
    if (browser.ie && browser.ie_version <= 11) { DOMChange.start(view) }
    return
  }
  var slice = fromClipboard(view, e.clipboardData, view.shiftKey, view.state.selection.$from)
  if (slice) {
    e.preventDefault()
    view.someProp("transformPasted", function (f) { slice = f(slice) })
    var singleNode = sliceSingleNode(slice)
    var tr = singleNode ? view.state.tr.replaceSelectionWith(singleNode) : view.state.tr.replaceSelection(slice)
    view.dispatch(tr.scrollIntoView())
  }
}

var Dragging = function(state, slice, range, move) {
  this.slice = slice
  this.range = range
  this.move = move && new TrackMappings(state)
};

Dragging.prototype.destroy = function () {
  if (this.move) { this.move.destroy() }
};

function clearDragging(view) {
  if (view.dragging) {
    view.dragging.destroy()
    view.dragging = null
  }
}

function dropPos(slice, $pos) {
  if (!slice || !slice.content.size) { return $pos.pos }
  var content = slice.content
  for (var i = 0; i < slice.openLeft; i++) { content = content.firstChild.content }
  for (var d = $pos.depth; d >= 0; d--) {
    var bias = d == $pos.depth ? 0 : $pos.pos <= ($pos.start(d + 1) + $pos.end(d + 1)) / 2 ? -1 : 1
    var insertPos = $pos.index(d) + (bias > 0 ? 1 : 0)
    if ($pos.node(d).canReplace(insertPos, insertPos, content))
      { return bias == 0 ? $pos.pos : bias < 0 ? $pos.before(d + 1) : $pos.after(d + 1) }
  }
  return $pos.pos
}

handlers.dragstart = function (view, e) {
  var mouseDown = view.mouseDown
  if (mouseDown) { mouseDown.done() }
  if (!e.dataTransfer) { return }

  var sel = view.state.selection, draggedRange
  var pos = sel.empty ? null : view.posAtCoords(eventCoords(e))
  if (pos != null && pos.pos >= sel.from && pos.pos <= sel.to)
    { draggedRange = sel }
  else if (mouseDown && mouseDown.mightDrag)
    { draggedRange = NodeSelection.create(view.state.doc, mouseDown.mightDrag.pos) }

  if (draggedRange) {
    var slice = toClipboard(view, draggedRange, e.dataTransfer)
    view.dragging = new Dragging(view.state, slice, draggedRange, !e.ctrlKey)
  }
}

handlers.dragend = function (view) {
  window.setTimeout(function () { return clearDragging(view); }, 50)
}

editHandlers.dragover = editHandlers.dragenter = function (_, e) { return e.preventDefault(); }

editHandlers.drop = function (view, e) {
  var dragging = view.dragging
  clearDragging(view)

  if (!e.dataTransfer) { return }

  var $mouse = view.state.doc.resolve(view.posAtCoords(eventCoords(e)).pos)
  if (!$mouse) { return }
  var slice = dragging && dragging.slice || fromClipboard(view, e.dataTransfer, false, $mouse)
  if (!slice) { return }
  var insertPos = dropPos(slice, view.state.doc.resolve($mouse.pos))

  e.preventDefault()
  var tr = view.state.tr
  if (dragging && dragging.move) {
    var ref = dragging.range;
    var from = ref.from;
    var to = ref.to;
    var mapping = dragging.move.getMapping(view.state)
    if (mapping) { tr.deleteRange(mapping.map(from, 1), mapping.map(to, -1)) }
  }
  view.someProp("transformPasted", function (f) { slice = f(slice) })
  var pos = tr.mapping.map(insertPos)
  var isNode = slice.openLeft == 0 && slice.openRight == 0 && slice.content.childCount == 1
  if (isNode)
    { tr.replaceRangeWith(pos, pos, slice.content.firstChild) }
  else
    { tr.replaceRange(pos, pos, slice) }
  var $pos = tr.doc.resolve(pos)
  if (isNode && NodeSelection.isSelectable(slice.content.firstChild) &&
      $pos.nodeAfter && $pos.nodeAfter.sameMarkup(slice.content.firstChild))
    { tr.setSelection(new NodeSelection($pos)) }
  else
    { tr.setSelection(Selection.between($pos, tr.doc.resolve(tr.mapping.map(insertPos)))) }
  view.focus()
  view.dispatch(tr)
}

handlers.focus = function (view, event) {
  if (!view.focused) {
    view.content.classList.add("ProseMirror-focused")
    view.focused = true
  }
  view.someProp("onFocus", function (f) { f(view, event) })
}

handlers.blur = function (view, event) {
  if (view.focused) {
    view.content.classList.remove("ProseMirror-focused")
    view.focused = false
  }
  view.someProp("onBlur", function (f) { f(view, event) })
}

// Make sure all handlers get registered
for (var prop in editHandlers) { handlers[prop] = editHandlers[prop] }
