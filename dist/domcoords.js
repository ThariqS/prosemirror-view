function windowRect() {
  return {left: 0, right: window.innerWidth,
          top: 0, bottom: window.innerHeight}
}

function parentNode(node) {
  var parent = node.parentNode
  return parent.nodeType == 11 ? parent.host : parent
}

function scrollRectIntoView(view, rect) {
  var scrollThreshold = view.someProp("scrollThreshold") || 0, scrollMargin = view.someProp("scrollMargin")
  if (scrollMargin == null) { scrollMargin = 5 }
  for (var parent = view.content;; parent = parentNode(parent)) {
    var atBody = parent == document.body
    var bounding = atBody ? windowRect() : parent.getBoundingClientRect()
    var moveX = 0, moveY = 0
    if (rect.top < bounding.top + scrollThreshold)
      { moveY = -(bounding.top - rect.top + scrollMargin) }
    else if (rect.bottom > bounding.bottom - scrollThreshold)
      { moveY = rect.bottom - bounding.bottom + scrollMargin }
    if (rect.left < bounding.left + scrollThreshold)
      { moveX = -(bounding.left - rect.left + scrollMargin) }
    else if (rect.right > bounding.right - scrollThreshold)
      { moveX = rect.right - bounding.right + scrollMargin }
    if (moveX || moveY) {
      if (atBody) {
        window.scrollBy(moveX, moveY)
      } else {
        if (moveY) { parent.scrollTop += moveY }
        if (moveX) { parent.scrollLeft += moveX }
      }
    }
    if (atBody) { break }
  }
}
exports.scrollRectIntoView = scrollRectIntoView

// Store the scroll position of the editor's parent nodes, along with
// the top position of an element near the top of the editor, which
// will be used to make sure the visible viewport remains stable even
// when the size of the content above changes.
function storeScrollPos(view) {
  var rect = view.content.getBoundingClientRect(), startY = Math.max(0, rect.top)
  var refDOM, refTop
  for (var x = (rect.left + rect.right) / 2, y = startY + 1;
       y < Math.min(innerHeight, rect.bottom); y += 5) {
    var dom = view.root.elementFromPoint(x, y)
    if (dom == view.content || !view.content.contains(dom)) { continue }
    var localRect = dom.getBoundingClientRect()
    if (localRect.top >= startY - 20) {
      refDOM = dom
      refTop = localRect.top
      break
    }
  }
  var stack = []
  for (var dom$1 = view.content; dom$1; dom$1 = parentNode(dom$1)) {
    stack.push({dom: dom$1, top: dom$1.scrollTop, left: dom$1.scrollLeft})
    if (dom$1 == document.body) { break }
  }
  return {refDOM: refDOM, refTop: refTop, stack: stack}
}
exports.storeScrollPos = storeScrollPos

// Reset the scroll position of the editor's parent nodes to that what
// it was before, when storeScrollPos was called.
function resetScrollPos(ref) {
  var refDOM = ref.refDOM;
  var refTop = ref.refTop;
  var stack = ref.stack;

  var newRefTop = refDOM ? refDOM.getBoundingClientRect().top : 0
  var dTop = newRefTop == 0 ? 0 : newRefTop - refTop
  for (var i = 0; i < stack.length; i++) {
    var ref$1 = stack[i];
    var dom = ref$1.dom;
    var top = ref$1.top;
    var left = ref$1.left;
    if (dom.scrollTop != top + dTop) { dom.scrollTop = top + dTop }
    if (dom.scrollLeft != left) { dom.scrollLeft = left }
  }
}
exports.resetScrollPos = resetScrollPos

function findOffsetInNode(node, coords) {
  var closest, dxClosest = 2e8, coordsClosest, offset = 0
  var rowBot = coords.top, rowTop = coords.top
  for (var child = node.firstChild, childIndex = 0; child; child = child.nextSibling, childIndex++) {
    var rects = (void 0)
    if (child.nodeType == 1) { rects = child.getClientRects() }
    else if (child.nodeType == 3) { rects = textRange(child).getClientRects() }
    else { continue }

    for (var i = 0; i < rects.length; i++) {
      var rect = rects[i]
      if (rect.top <= rowBot && rect.bottom >= rowTop) {
        rowBot = Math.max(rect.bottom, rowBot)
        rowTop = Math.min(rect.top, rowTop)
        var dx = rect.left > coords.left ? rect.left - coords.left
            : rect.right < coords.left ? coords.left - rect.right : 0
        if (dx < dxClosest) {
          closest = child
          dxClosest = dx
          coordsClosest = dx && closest.nodeType == 3 ? {left: rect.right < coords.left ? rect.right : rect.left, top: coords.top} : coords
          if (child.nodeType == 1 && dx)
            { offset = childIndex + (coords.left >= (rect.left + rect.right) / 2 ? 1 : 0) }
          continue
        }
      }
      if (!closest && (coords.left >= rect.right && coords.top >= rect.top ||
                       coords.left >= rect.left && coords.top >= rect.bottom))
        { offset = childIndex + 1 }
    }
  }
  if (closest && closest.nodeType == 3) { return findOffsetInText(closest, coordsClosest) }
  if (!closest || (dxClosest && closest.nodeType == 1)) { return {node: node, offset: offset} }
  return findOffsetInNode(closest, coordsClosest)
}

function findOffsetInText(node, coords) {
  var len = node.nodeValue.length
  var range = document.createRange()
  for (var i = 0; i < len; i++) {
    range.setEnd(node, i + 1)
    range.setStart(node, i)
    var rect = singleRect(range, 1)
    if (rect.top == rect.bottom) { continue }
    if (rect.left - 1 <= coords.left && rect.right + 1 >= coords.left &&
        rect.top - 1 <= coords.top && rect.bottom + 1 >= coords.top)
      { return {node: node, offset: i + (coords.left >= (rect.left + rect.right) / 2 ? 1 : 0)} }
  }
  return {node: node, offset: 0}
}

function targetKludge(dom, coords) {
  if (/^[uo]l$/i.test(dom.nodeName)) {
    for (var child = dom.firstChild; child; child = child.nextSibling) {
      if (!child.pmViewDesc || !/^li$/i.test(child.nodeName)) { continue }
      var childBox = child.getBoundingClientRect()
      if (coords.left > childBox.left - 2) { break }
      if (childBox.top <= coords.top && childBox.bottom >= coords.top) { return child }
    }
  }
  return dom
}

// Given an x,y position on the editor, get the position in the document.
function posAtCoords(view, coords) {
  var elt = targetKludge(view.root.elementFromPoint(coords.left, coords.top + 1), coords)
  if (!view.content.contains(elt.nodeType == 3 ? elt.parentNode : elt)) { return null }

  var ref = findOffsetInNode(elt, coords);
  var node = ref.node;
  var offset = ref.offset;
  var bias = -1
  if (node.nodeType == 1 && !node.firstChild) {
    var rect = node.getBoundingClientRect()
    bias = rect.left != rect.right && coords.left > (rect.left + rect.right) / 2 ? 1 : -1
  }

  var desc = view.docView.nearestDesc(elt, true)
  return {pos: view.docView.posFromDOM(node, offset, bias),
          inside: desc && (desc.posAtStart - desc.border)}
}
exports.posAtCoords = posAtCoords

function textRange(node, from, to) {
  var range = document.createRange()
  range.setEnd(node, to == null ? node.nodeValue.length : to)
  range.setStart(node, from || 0)
  return range
}

function singleRect(object, bias) {
  var rects = object.getClientRects()
  return !rects.length ? object.getBoundingClientRect() : rects[bias < 0 ? 0 : rects.length - 1]
}

// : (EditorView, number) → {left: number, top: number, right: number, bottom: number}
// Given a position in the document model, get a bounding box of the
// character at that position, relative to the window.
function coordsAtPos(view, pos) {
  var ref = view.docView.domFromPos(pos);
  var node = ref.node;
  var offset = ref.offset;
  var side, rect
  if (node.nodeType == 3) {
    if (offset < node.nodeValue.length) {
      rect = singleRect(textRange(node, offset, offset + 1), -1)
      side = "left"
    }
    if ((!rect || rect.left == rect.right) && offset) {
      rect = singleRect(textRange(node, offset - 1, offset), 1)
      side = "right"
    }
  } else if (node.firstChild) {
    if (offset < node.childNodes.length) {
      var child = node.childNodes[offset]
      rect = singleRect(child.nodeType == 3 ? textRange(child) : child, -1)
      side = "left"
    }
    if ((!rect || rect.top == rect.bottom) && offset) {
      var child$1 = node.childNodes[offset - 1]
      rect = singleRect(child$1.nodeType == 3 ? textRange(child$1) : child$1, 1)
      side = "right"
    }
  } else {
    rect = node.getBoundingClientRect()
    side = "left"
  }
  var x = rect[side]
  return {top: rect.top, bottom: rect.bottom, left: x, right: x}
}
exports.coordsAtPos = coordsAtPos

function withFlushedState(view, state, f) {
  var viewState = view.state, active = view.root.activeElement
  if (viewState != state || !view.inDOMChange) { view.updateState(state) }
  if (active != view.content) { view.focus() }
  try {
    return f()
  } finally {
    if (viewState != state) { view.updateState(viewState) }
    if (active != view.content) { active.focus() }
  }
}

// : (EditorView, number, number)
// Whether vertical position motion in a given direction
// from a position would leave a text block.
function endOfTextblockVertical(view, state, dir) {
  var $pos = dir == "up" ? state.selection.$from : state.selection.$to
  if (!$pos.depth) { return false }
  return withFlushedState(view, state, function () {
    var dom = view.docView.domAfterPos($pos.before())
    var coords = coordsAtPos(view, $pos.pos)
    for (var child = dom.firstChild; child; child = child.nextSibling) {
      var boxes = (void 0)
      if (child.nodeType == 1) { boxes = child.getClientRects() }
      else if (child.nodeType == 3) { boxes = textRange(child, 0, child.nodeValue.length).getClientRects() }
      else { continue }
      for (var i = 0; i < boxes.length; i++) {
        var box = boxes[i]
        if (dir == "up" ? box.bottom < coords.top + 1 : box.top > coords.bottom - 1)
          { return false }
      }
    }
    return true
  })
}

var maybeRTL = /[\u0590-\u08ac]/

function endOfTextblockHorizontal(view, state, dir) {
  var ref = state.selection;
  var $head = ref.$head;
  var empty = ref.empty;
  if (!empty || !$head.parent.isTextblock || !$head.depth) { return false }
  var offset = $head.parentOffset, atStart = !offset, atEnd = offset == $head.parent.content.size
  // If the textblock is all LTR and the cursor isn't at the sides, we don't need to touch the DOM
  if (!atStart && !atEnd && !maybeRTL.test($head.parent.textContent)) { return false }
  var sel = getSelection()
  // Fall back to a primitive approach if the necessary selection method isn't supported (Edge)
  if (!sel.modify) { return dir == "left" || dir == "backward" ? atStart : atEnd }

  return withFlushedState(view, state, function () {
    // This is a huge hack, but appears to be the best we can
    // currently do: use `Selection.modify` to move the selection by
    // one character, and see if that moves the cursor out of the
    // textblock (or doesn't move it at all, when at the start/end of
    // the document).
    var oldRange = sel.getRangeAt(0)
    sel.modify("move", dir, "character")
    var parentDOM = view.docView.domAfterPos($head.before())
    var result = !parentDOM.contains(sel.focusNode.nodeType == 1 ? sel.focusNode : sel.focusNode.parentNode) ||
        view.docView.posFromDOM(sel.focusNode, sel.focusOffset) == $head.pos
    // Restore the previous selection
    sel.removeAllRanges()
    sel.addRange(oldRange)
    return result
  })
}

var cachedState = null, cachedDir = null, cachedResult = false
function endOfTextblock(view, state, dir) {
  if (cachedState == state && cachedDir == dir) { return cachedResult }
  cachedState = state; cachedDir = dir
  return cachedResult = dir == "up" || dir == "down"
    ? endOfTextblockVertical(view, state, dir)
    : endOfTextblockHorizontal(view, state, dir)
}
exports.endOfTextblock = endOfTextblock
