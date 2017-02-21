var ref = require("./domcoords");
var scrollRectIntoView = ref.scrollRectIntoView;
var posAtCoords = ref.posAtCoords;
var coordsAtPos = ref.coordsAtPos;
var endOfTextblock = ref.endOfTextblock;
var storeScrollPos = ref.storeScrollPos;
var resetScrollPos = ref.resetScrollPos;
var ref$1 = require("./viewdesc");
var docViewDesc = ref$1.docViewDesc;
var ref$2 = require("./input");
var initInput = ref$2.initInput;
var destroyInput = ref$2.destroyInput;
var dispatchEvent = ref$2.dispatchEvent;
var startObserving = ref$2.startObserving;
var stopObserving = ref$2.stopObserving;
var ensureListeners = ref$2.ensureListeners;
var ref$3 = require("./selection");
var SelectionReader = ref$3.SelectionReader;
var selectionToDOM = ref$3.selectionToDOM;
var ref$4 = require("./decoration");
var viewDecorations = ref$4.viewDecorations;
var Decoration = ref$4.Decoration;var assign;
((assign = require("./decoration"), exports.Decoration = assign.Decoration, exports.DecorationSet = assign.DecorationSet))

// ::- An editor view manages the DOM structure that represents an
// editor. Its state and behavior are determined by its
// [props](#view.EditorProps).
var EditorView = function(place, props) {
  // :: EditorProps
  // The view's current [props](#view.EditorProps).
  this.props = props
  // :: EditorState
  // The view's current [state](#state.EditorState).
  this.state = props.state

  this.dispatch = this.dispatch.bind(this)

  this._root = null
  this.focused = false

  // :: dom.Element
  // The editable DOM node containing the document. (You probably
  // should not be directly interfering with its child nodes.)
  this.content = document.createElement("div")

  if (place && place.appendChild) { place.appendChild(this.content) }
  else if (place) { place(this.content) }

  this.editable = getEditable(this)
  this.docView = docViewDesc(this.state.doc, computeDocDeco(this), viewDecorations(this), this.content, this)

  this.lastSelectedViewDesc = null
  this.selectionReader = new SelectionReader(this)
  initInput(this)

  this.pluginViews = []
  this.updatePluginViews()
};

var prototypeAccessors = { root: {} };

// :: (EditorProps)
// Update the view's props. Will immediately cause an update to
// the view's DOM.
EditorView.prototype.update = function (props) {
  if (props.handleDOMEvents != this.props.handleDOMEvents) { ensureListeners(this) }
  this.props = props
  this.updateState(props.state)
};

// :: (EditorState)
// Update the editor's `state` prop, without touching any of the
// other props.
EditorView.prototype.updateState = function (state) {
  var prev = this.state
  this.state = state
  if (prev.plugins != state.plugins) { ensureListeners(this) }

  if (this.inDOMChange) { return }

  var prevEditable = this.editable
  this.editable = getEditable(this)
  var innerDeco = viewDecorations(this), outerDeco = computeDocDeco(this)

  var scrollToSelection = state.scrollToSelection > prev.scrollToSelection || prev.config != state.config
  var updateDoc = !this.docView.matchesNode(state.doc, outerDeco, innerDeco)
  var updateSel = updateDoc || !state.selection.eq(prev.selection) || this.selectionReader.domChanged()
  var oldScrollPos = !scrollToSelection && updateSel && storeScrollPos(this)

  if (updateSel) {
    stopObserving(this)
    if (updateDoc) { this.docView.update(state.doc, outerDeco, innerDeco, this) }
    selectionToDOM(this, state.selection)
    startObserving(this)
  }

  if (prevEditable != this.editable) { this.selectionReader.editableChanged() }
  this.updatePluginViews(prev)

  if (scrollToSelection) {
    if (state.selection.node)
      { scrollRectIntoView(this, this.docView.domAfterPos(state.selection.from).getBoundingClientRect()) }
    else
      { scrollRectIntoView(this, this.coordsAtPos(state.selection.head)) }
  } else if (oldScrollPos) {
    resetScrollPos(oldScrollPos)
  }
};

EditorView.prototype.destroyPluginViews = function () {
  var view
  while (view = this.pluginViews.pop()) { if (view.destroy) { view.destroy() } }
};

EditorView.prototype.updatePluginViews = function (prevState) {
    var this$1 = this;

  var plugins = this.state.plugins
  if (!prevState || prevState.plugins != plugins) {
    this.destroyPluginViews()
    for (var i = 0; i < plugins.length; i++) {
      var plugin = plugins[i]
      if (plugin.options.view) { this$1.pluginViews.push(plugin.options.view(this$1)) }
    }
  } else {
    for (var i$1 = 0; i$1 < this.pluginViews.length; i$1++) {
      var pluginView = this$1.pluginViews[i$1]
      if (pluginView.update) { pluginView.update(this$1) }
    }
  }
};

// :: () → bool
// Query whether the view has focus.
EditorView.prototype.hasFocus = function () {
  if (this.editable && this.content.ownerDocument.activeElement != this.content) { return false }
  var sel = this.root.getSelection()
  return sel.rangeCount && this.content.contains(sel.anchorNode.nodeType == 3 ? sel.anchorNode.parentNode : sel.anchorNode)
};

// :: (string, (prop: *) → *) → *
// Goes over the values of a prop, first those provided directly,
// then those from plugins (in order), and calls `f` every time a
// non-undefined value is found. When `f` returns a truthy value,
// that is immediately returned. When `f` isn't provided, it is
// treated as the identity function (the prop value is returned
// directly).
EditorView.prototype.someProp = function (propName, f) {
  var prop = this.props && this.props[propName], value
  if (prop != null && (value = f ? f(prop) : prop)) { return value }
  var plugins = this.state.plugins
  if (plugins) { for (var i = 0; i < plugins.length; i++) {
    var prop$1 = plugins[i].props[propName]
    if (prop$1 != null && (value = f ? f(prop$1) : prop$1)) { return value }
  } }
};

// :: ()
// Focus the editor.
EditorView.prototype.focus = function () {
  stopObserving(this)
  selectionToDOM(this, this.state.selection, true)
  startObserving(this)
  if (this.editable) { this.content.focus() }
};

// :: union<dom.Document, dom.DocumentFragment>
// Get the document root in which the editor exists. This will
// usually be the top-level `document`, but might be a shadow DOM
// root if the editor is inside a shadow DOM.
prototypeAccessors.root.get = function () {
    var this$1 = this;

  var cached = this._root
  if (cached == null) { for (var search = this.content.parentNode; search; search = search.parentNode) {
    if (search.nodeType == 9 || (search.nodeType == 11 && search.host))
      { return this$1._root = search }
  } }
  return cached || document
};

// :: ({left: number, top: number}) → ?{pos: number, inside: number}
// Given a pair of coordinates, return the document position that
// corresponds to them. May return null if the given coordinates
// aren't inside of the visible editor. When an object is returned,
// its `pos` property is the position nearest to the coordinates,
// and its `inside` property holds the position before the inner
// node that the click happened inside of, or -1 if the click was at
// the top level.
EditorView.prototype.posAtCoords = function (coords) { return posAtCoords(this, coords) };

// :: (number) → {left: number, right: number, top: number, bottom: number}
// Returns the screen rectangle at a given document position. `left`
// and `right` will be the same number, as this returns a flat
// cursor-ish rectangle.
EditorView.prototype.coordsAtPos = function (pos) { return coordsAtPos(this, pos) };

// :: (union<"up", "down", "left", "right", "forward", "backward">, ?EditorState) → bool
// Find out whether the selection is at the end of a textblock when
// moving in a given direction. When, for example, given `"left"`,
// it will return true if moving left from the current cursor
// position would leave that position's parent textblock. For
// horizontal motion, it will always return false if the selection
// isn't a cursor selection.
EditorView.prototype.endOfTextblock = function (dir, state) {
  return endOfTextblock(this, state || this.state, dir)
};

// :: ()
// Removes the editor from the DOM and destroys all [node
// views](#view.NodeView).
EditorView.prototype.destroy = function () {
  destroyInput(this)
  this.destroyPluginViews()
  this.docView.destroy()
  this.selectionReader.destroy()
  if (this.content.parentNode) { this.content.parentNode.removeChild(this.content) }
};

// Used for testing.
EditorView.prototype.dispatchEvent = function (event) {
  return dispatchEvent(this, event)
};

// :: (Transaction)
// Dispatch a transaction. Will call the
// [`dispatchTransaction`](#view.EditorProps.dispatchTransaction) when given,
// and defaults to applying the transaction to the current state and
// calling [`updateState`](#view.EditorView.updateState) otherwise.
// This method is bound to the view instance, so that it can be
// easily passed around.
EditorView.prototype.dispatch = function (tr) {
  var dispatchTransaction = this.props.dispatchTransaction
  if (dispatchTransaction) { dispatchTransaction(tr) }
  else { this.updateState(this.state.apply(tr)) }
};

Object.defineProperties( EditorView.prototype, prototypeAccessors );
exports.EditorView = EditorView

function computeDocDeco(view) {
  var attrs = Object.create(null)
  attrs.class = "ProseMirror" + (view.focused ? " ProseMirror-focused" : "") +
    (view.state.selection.node ? " ProseMirror-nodeselection" : "")
  attrs.contenteditable = String(view.editable)

  view.someProp("attributes", function (value) {
    if (typeof value == "function") { value = value(view.state) }
    if (value) { for (var attr in value) {
      if (attr == "class")
        { attrs.class += " " + value[attr] }
      else if (!attrs[attr] && attr != "contenteditable" && attr != "nodeName")
        { attrs[attr] = String(value[attr]) }
    } }
  })

  return [Decoration.node(0, view.state.doc.content.size, attrs)]
}

function getEditable(view) {
  return !view.someProp("editable", function (value) { return value(view.state) === false; })
}

// EditorProps:: interface
//
// The configuration object that can be passed to an editor view. It
// supports the following properties (only `state` is required).
//
// The various event-handling functions may all return `true` to
// indicate that they handled the given event. The view will then take
// care to call `preventDefault` on the event, except with
// `handleDOMEvents`, where the handler itself is responsible for that.
//
// Except for `state` and `dispatchTransaction`, these may also be
// present on the `props` property of plugins. How a prop is resolved
// depends on the prop. Handler functions are called one at a time,
// starting with the plugins (in order of appearance), and finally
// looking at the base props, until one of them returns true. For some
// props, the first plugin that yields a value gets precedence. For
// `class`, all the classes returned are combined.
//
//   state:: EditorState
//   The state of the editor.
//
//   dispatchTransaction:: ?(tr: Transaction)
//   The callback over which to send transactions (state updates)
//   produced by the view. You'll usually want to make sure this ends
//   up calling the view's
//   [`updateState`](#view.EditorView.updateState) method with a new
//   state that has the transaction
//   [applied](#state.EditorState.apply).
//
//   handleDOMEvents:: ?Object<(view: EditorView, event: dom.Event) → bool>
//   Can be an object mapping DOM event type names to functions that
//   handle them. Such functions will be called before any handling
//   ProseMirror does of events fired on the editable DOM element.
//   Contrary to the other event handling props, when returning true
//   from such a function, you are responsible for calling
//   `preventDefault` yourself (or not, if you want to allow the
//   default behavior).
//
//   handleKeyDown:: ?(view: EditorView, event: dom.KeyboardEvent) → bool
//   Called when the editor receives a `keydown` event.
//
//   handleKeyPress:: ?(view: EditorView, event: dom.KeyboardEvent) → bool
//   Handler for `keypress` events.
//
//   handleTextInput:: ?(view: EditorView, from: number, to: number, text: string) → bool
//   Whenever the user directly input text, this handler is called
//   before the input is applied. If it returns `true`, the default
//   effect of actually inserting the text is suppressed.
//
//   handleClickOn:: ?(view: EditorView, pos: number, node: Node, nodePos: number, event: dom.MouseEvent, direct: bool) → bool
//   Called for each node around a click, from the inside out. The
//   `direct` flag will be true for the inner node.
//
//   handleClick:: ?(view: EditorView, pos: number, event: dom.MouseEvent) → bool
//   Called when the editor is clicked, after `handleClickOn` handlers
//   have been called.
//
//   handleDoubleClickOn:: ?(view: EditorView, pos: number, node: Node, nodePos: number, event: dom.MouseEvent, direct: bool) → bool
//   Called for each node around a double click.
//
//   handleDoubleClick:: ?(view: EditorView, pos: number, event: dom.MouseEvent) → bool
//   Called when the editor is double-clicked, after `handleDoubleClickOn`.
//
//   handleTripleClickOn:: ?(view: EditorView, pos: number, node: Node, nodePos: number, event: dom.MouseEvent, direct: bool) → bool
//   Called for each node around a triple click.
//
//   handleTripleClick:: ?(view: EditorView, pos: number, event: dom.MouseEvent) → bool
//   Called when the editor is triple-clicked, after `handleTripleClickOn`.
//
//   handleContextMenu:: ?(view: EditorView, pos: number, event: dom.MouseEvent) → bool
//   Called when a context menu event is fired in the editor.
//
//   onFocus:: ?(view: EditorView, event: dom.Event)
//   Called when the editor is focused.
//
//   onBlur:: ?(view: EditorView, event: dom.Event)
//   Called when the editor loses focus.
//
//   domParser:: ?DOMParser
//   The [parser](#model.DOMParser) to use when reading editor changes
//   from the DOM. Defaults to calling
//   [`DOMParser.fromSchema`](#model.DOMParser^fromSchema) on the
//   editor's schema.
//
//   clipboardParser:: ?DOMParser
//   The [parser](#model.DOMParser) to use when reading content from
//   the clipboard. When not given, the value of the
//   [`domParser`](#view.EditorProps.domParser) prop is used.
//
//   transformPasted:: ?(Slice) → Slice
//   Can be used to transform pasted content before it is applied to
//   the document.
//
//   transformPastedHTML:: ?(string) → string
//   Can be used to transform pasted HTML text, _before_ it is parsed,
//   for example to clean it up.
//
//   transformPastedText:: ?(string) → string
//   Transform pasted plain text.
//
//   nodeViews:: ?Object<(node: Node, view: EditorView, getPos: () → number, decorations: [Decoration]) → NodeView>
//   Allows you to pass custom rendering and behavior logic for nodes
//   and marks. Should map node and mark names to constructor function
//   that produce a [`NodeView`](#view.NodeView) object implementing
//   the node's display behavior. `getPos` is a function that can be
//   called to get the node's current position, which can be useful
//   when creating transactions that update it.
//
//   `decorations` is an array of node or inline decorations that are
//   active around the node. They are automatically drawn in the
//   normal way, and you will usually just want to ignore this, but
//   they can also be used as a way to provide context information to
//   the node view without adding it to the document itself.
//
//   clipboardSerializer:: ?DOMSerializer
//   The DOM serializer to use when putting content onto the
//   clipboard. If not given, the result of
//   [`DOMSerializer.fromSchema`](#model.DOMSerializer^fromSchema)
//   will be used.
//
//   decorations:: ?(EditorState) → ?DecorationSet
//   A set of [document decorations](#view.Decoration) to add to the
//   view.
//
//   editable:: ?(EditorState) → bool
//   When this returns false, the content of the view is not directly
//   editable.
//
//   attributes:: ?union<Object<string>, (EditorState) → ?Object<string>>
//   Control the DOM attributes of the editable element. May be either
//   an object or a function going from an editor state to an object.
//   By default, the element will get a class `"ProseMirror"`, and
//   will have its `contentEditable` attribute determined by the
//   [`editable` prop](#view.EditorProps.editable). Additional classes
//   provided here will be added to the class. For other attributes,
//   the value provided first (as in
//   [`someProp`](#view.EditorView.someProp)) will be used.
//
//   scrollThreshold:: ?number
//   Determines the distance (in pixels) between the cursor and the
//   end of the visible viewport at which point, when scrolling the
//   cursor into view, scrolling takes place. Defaults to 0.
//
//   scrollMargin:: ?number
//   Determines the extra space (in pixels) that is left above or
//   below the cursor when it is scrolled into view. Defaults to 5.