import React, { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { fileSave } from "browser-fs-access"

import { Api as RevealApi } from "reveal.js"

import {
    DefaultToolbar,
	DefaultToolbarContent,
	TLComponents,
	useEditor,
	useIsToolSelected,
	useTools,
    Box,
    Editor,
    Tldraw,
    DefaultQuickActions,
    DefaultQuickActionsContent,
    TldrawUiMenuItem,
    AlignMenuItems,
    DistributeMenuItems,
    EditLinkMenuItem,
    GroupOrUngroupMenuItem,
    ReorderMenuItems,
    RotateCWMenuItem,
    StackMenuItems,
    DefaultActionsMenu,
    createTLStore,
    defaultShapeUtils,
    throttle,
    PageRecordType,
    TldrawUiMenuSubmenu,
    TldrawUiMenuGroup,
    TLUiActionsContextType,
    useActions,
    DefaultMainMenu,
    EditSubmenu,
    ExportFileContentSubMenu,
    ExtrasGroup,
    PreferencesGroup,
    transact,
    TLShapeId,
    createTLUser,
    TLUserPreferences,
    TldrawUiMenuCheckboxItem,
    TLStore,
    TLStoreSnapshot,
    TLSessionStateSnapshot,
    getSnapshot,
    loadSnapshot
} from "tldraw"
import {
    SelectToolbarItem,
    HandToolbarItem,
    DrawToolbarItem,
    EraserToolbarItem,
    ArrowToolbarItem,
    TextToolbarItem,
    NoteToolbarItem,
    AssetToolbarItem,
    RectangleToolbarItem,
    EllipseToolbarItem,
    TriangleToolbarItem,
    DiamondToolbarItem,
    HexagonToolbarItem,
    OvalToolbarItem,
    RhombusToolbarItem,
    StarToolbarItem,
    CloudToolbarItem,
    XBoxToolbarItem,
    CheckBoxToolbarItem,
    ArrowLeftToolbarItem,
    ArrowUpToolbarItem,
    ArrowDownToolbarItem,
    ArrowRightToolbarItem,
    LineToolbarItem,
    HighlightToolbarItem,
    LaserToolbarItem,
    FrameToolbarItem
} from "tldraw";
import { useAtom } from "@tldraw/state"

import { debounce, makeInt, parseOptionalBoolean } from "./util"
import { defaultStyleProps, getTldrevealConfig } from "./config";

// for history slider based on https://gist.github.com/steveruizok/232e9bf621e3d2dfaebd4f198c7e69fc
import { RecordsDiff, TLRecord } from '@tldraw/editor'
import { useRef } from 'react'
// for custom panel including playback stuff
import { DefaultToolbarProps, TldrawUiPopover, TldrawUiPopoverTrigger, TldrawUiPopoverContent, TldrawUiButton, TldrawUiButtonIcon } from 'tldraw'
import { PORTRAIT_BREAKPOINT, useBreakpoint, useTldrawUiComponents, useReadonly } from 'tldraw'
import { useValue } from '@tldraw/editor'
import { ReactNode, memo } from 'react'
//import { MobileStylePanel} from 'tldraw/src/lib/ui/components/MobileStylePanel'
//import { OverflowingToolbar } from 'tldraw/src/lib/ui/components/Toolbar/OverflowingToolbar'
//import { ToggleToolLockedButton } from 'tldraw/src/lib/ui/components/Toolbar/ToggleToolLockedButton'

// TODO:
// - Somehow create overlaid pages for fragment navigation
// - Fix the overlay in scroll mode
// - Fix the 40 slides with drawings limit (that's tldraw's (artificial) page limit)

const TLDREVEAL_FILE_EXTENSION = ".tldrev"

interface FileSubmenuProps {
    canUseLocalStorage: boolean
    saveToLocalStorage: boolean
}

function FileSubmenu({ canUseLocalStorage, saveToLocalStorage }: FileSubmenuProps) {
    const actions = useActions()

    const mainGroup =
        <TldrawUiMenuGroup  id="tldreveal-file-main">
            <TldrawUiMenuItem {...actions["tldreveal.save-file"]} />
        </TldrawUiMenuGroup>

    if (canUseLocalStorage) {
        return (
            <TldrawUiMenuSubmenu id="tldreveal-file" label="tldreveal.menu.file">
                {mainGroup}
                <TldrawUiMenuGroup id="tldreveal-file-localstorage">
                    <TldrawUiMenuCheckboxItem
                        checked={saveToLocalStorage}
                        {...actions["tldreveal.toggle-save-to-localstorage"]}
                    />
                    <TldrawUiMenuItem {...actions["tldreveal.clear-localstorage"]} />
                </TldrawUiMenuGroup>
            </TldrawUiMenuSubmenu>
        )
    } else {
        return mainGroup
    }
}

function ClearSubmenu() {
    const actions = useActions()
    return (
        <TldrawUiMenuSubmenu id="tldreveal-clear" label="tldreveal.menu.clear">
            <TldrawUiMenuGroup id="tldreveal-clear-group">
                <TldrawUiMenuItem {...actions["tldreveal.clear-page"]} />
                <TldrawUiMenuItem {...actions["tldreveal.clear-deck"]} />
            </TldrawUiMenuGroup>
        </TldrawUiMenuSubmenu>
    )
}

function CustomMainMenu({ fileProps }: { fileProps: FileSubmenuProps }) {
    const actions = useActions()
    return (
        <DefaultMainMenu>
            <FileSubmenu {...fileProps} />
            <ClearSubmenu />
            <EditSubmenu />
			<ExportFileContentSubMenu />
			<ExtrasGroup />
			<PreferencesGroup />
            <TldrawUiMenuGroup id="open">
                <TldrawUiMenuItem {...actions["tldreveal.open"]} />
            </TldrawUiMenuGroup>
            <TldrawUiMenuGroup id="close">
                <TldrawUiMenuItem {...actions["tldreveal.close"]} />
            </TldrawUiMenuGroup>
        </DefaultMainMenu>
    )
}

function CustomQuickActions() {
    const actions = useActions()
    return (
        <DefaultQuickActions>
            <TldrawUiMenuItem {...actions["tldreveal.close"]} />
            <DefaultQuickActionsContent />
        </DefaultQuickActions>
    )
}

function CustomActionsMenu() {
    return (
        <DefaultActionsMenu>
            <AlignMenuItems />
            <DistributeMenuItems />
            <StackMenuItems />
            <ReorderMenuItems />
            <RotateCWMenuItem />
            <EditLinkMenuItem />
            <GroupOrUngroupMenuItem />
        </DefaultActionsMenu>
    )
}

export interface TldrevealOverlayProps {
    /// The instance of Reveal this overlaid on
    reveal: RevealApi
    /// The container element in which the overlay is rendered
    container: HTMLDivElement
}

export function TldrevealOverlay({ reveal, container }: TldrevealOverlayProps) {
    const config = getTldrevealConfig(reveal)

    function tryGetId(element: HTMLElement) : string | undefined {
        return element.getAttribute("data-tlid") || element.id || undefined
    }

    const deckId : string | undefined = useMemo(() => 
        tryGetId(reveal.getSlidesElement()) || tryGetId(reveal.getRevealElement())
    , [])

    const saveToLocalStorageKey = deckId && `TLDREVEAL_SAVE_TO_LOCALSTORAGE__${deckId}`
    const localStorageKey = deckId && `TLDREVEAL_SNAPSHOT__${deckId}`

    const [store] = useState(() => createTLStore({ shapeUtils: defaultShapeUtils }))
    const [editor, setEditor] = useState<Editor | undefined>()

    // BROKEN IN NEW VERSION OF TLDRAW ?
    // Use a local user preferences atom, to prevent sharing dark mode status
    // across multiple instances
    // const userPreferences = useAtom<TLUserPreferences>("userPreferences", { id: "tldreveal", isDarkMode: config.isDarkMode })
    // const [isolatedUser] = useState(() => createTLUser({ userPreferences, setUserPreferences: userPreferences.set }))
    // TEMPORARY FIX
    const userPreferences = useAtom<TLUserPreferences>("userPreferences", { id: "tldreveal" })
    const [isolatedUser] = useState(() => createTLUser({ userPreferences, setUserPreferences: userPreferences.set }))
    
    const [saveToLocalStorage, setSaveToLocalStorage_] = 
        useState(parseOptionalBoolean(localStorage.getItem(saveToLocalStorageKey)) ?? config.useLocalStorage)
    
    function setSaveToLocalStorage(value: boolean) {
        setSaveToLocalStorage_(value)
        localStorage.setItem(saveToLocalStorageKey, value ? "true" : "false")
    }
    
    const [isReady, setIsReady] = useState(false)
    const [isShown, setIsShown] = useState(true)
	const [isEditing, setIsEditing] = useState(false)

    const [currentSlide, setCurrentSlide] = useState<{ h: number, v: number }>(reveal.getIndices())

    const slideWidth = makeInt(reveal.getConfig().width)
    const slideHeight = makeInt(reveal.getConfig().height)
    const bounds = new Box(0, 0, slideWidth, slideHeight)

    function getSlideId(index: { h: number, v: number }) : string {
        const slideElement = reveal.getSlide(index.h, index.v)

        const givenId = tryGetId(slideElement)
        if (givenId !== undefined) {
            return givenId
        }

        if (index.v !== 0) {
            const stackId = tryGetId(slideElement.parentElement)
            if (stackId !== undefined) {
                return `${stackId}.${index.v}`
            }

            const firstInStackId = getSlideId({ h: index.h, v: 0 })
            if (firstInStackId.match("^\\d+\\.0$")) {
                return firstInStackId.replace(".0", `.${index.v}`)
            } else {
                return `${firstInStackId}.${index.v}`
            }
        }

        return `${index.h}.${index.v}`
    }

    const currentSlideId = useMemo(() => getSlideId(currentSlide), [ currentSlide ])

    function getTimestampedSnapshot(store: TLStore) : TLStoreSnapshot & TLSessionStateSnapshot & { timestamp: number } {
        const { document, session } = getSnapshot(store)
        return {
            timestamp: Date.now(),
            ...document,
            ...session
        }
    }

    async function loadInitial(store: TLStore) {
        let localStorageSnapshot: (TLStoreSnapshot & TLSessionStateSnapshot & { timestamp: number }) | undefined
        if (localStorageKey) {
            const snapshotJson = localStorage.getItem(localStorageKey)
            if (snapshotJson) {
                localStorageSnapshot = JSON.parse(snapshotJson)
            }
        }

        let uriSnapshot: (TLStoreSnapshot & TLSessionStateSnapshot & { timestamp: number }) | undefined
        if (config.snapshotUrl) {
            let uri
            if (config.snapshotUrl === "auto") {
                const path = window.location.pathname
                const ext = [ ".html", ".htm" ].find(ext => path.endsWith(ext))
                if (ext) {
                    uri = path.substring(0, path.length - ext.length) + ".tldrev"
                } else {
                    uri = "index.tldrev"
                }
            } else {
                uri = config.snapshotUrl.url
            }

            try {
                const res = await fetch(uri)
                if (res.ok) {
                    const snapshotJson = await res.text()
                    try {
                        const snapshot = JSON.parse(snapshotJson)
                        if (!(snapshot.timestamp && snapshot.store && snapshot.schema)) {
                            console.warn("Received invalid snapshot from", uri)
                        } else {
                            uriSnapshot = snapshot
                        }
                    } catch {
                        console.warn("Received invalid snapshot from", uri)
                    }
                } else {
                    if (config.snapshotUrl === "auto") {
                        console.log("No saved drawings found at auto-detected uri:", uri, "Got status:", res.status, res.statusText)
                    } else {
                        console.warn("Failed to load saved drawings from", uri, "Got status:", res.status, res.statusText)
                    }
                }
            } catch (err) {
                console.warn("Failed to fetch drawings from uri. Error:", err)
            }
        }

        let snapshot: (TLStoreSnapshot & TLSessionStateSnapshot & { timestamp: number }) | undefined
        if (localStorageSnapshot && uriSnapshot) {
            if (localStorageSnapshot.timestamp >= uriSnapshot.timestamp) {
                snapshot = localStorageSnapshot
            } else {
                // TODO: dialog, for now always load newest
                snapshot = uriSnapshot
            }
        } else {
            snapshot = localStorageSnapshot || uriSnapshot
        }

        if (snapshot) {
            loadSnapshot(store, snapshot)
        }

        setIsReady(true)
    }

    // https://tldraw.dev/examples/data/assets/local-storage
    useLayoutEffect(() => {
        loadInitial(store)
    }, [ store ])

    useEffect(() => {
        // If we can and want to use local storage, then listen to changes of
        // the store and save them
        if (localStorageKey && saveToLocalStorage) {
            const cleanupStoreListen = store.listen(
                throttle(() => {
                    const snapshot = getTimestampedSnapshot(store)
                    localStorage.setItem(localStorageKey, JSON.stringify(snapshot))
                }, 500)
            )

            return () => {
                cleanupStoreListen()
            }
        }
    }, [ store, saveToLocalStorage ])

    function initializeEditor(state = { editor, currentSlide }) {
        state.editor.setCurrentTool("draw")
        for (const style of Object.keys(config.defaultStyles)) {
            if (config.defaultStyles[style]) {
                state.editor.setStyleForNextShapes(defaultStyleProps[style], config.defaultStyles[style])
            }
        }
        state.editor.updateInstanceState({ 
            isDebugMode: false,
            exportBackground: false
        })
        syncEditor(state)
    }

    function onTldrawMount(editor: Editor) {
        setEditor(editor)
        initializeEditor({ editor, currentSlide })
    }

    useEffect(() => {
        container.classList.toggle("tldreveal-hidden", !isShown)

        if (isShown && isEditing) {
            container.classList.remove("tldreveal-inactive")
            container.setAttribute("data-prevent-swipe", "true")
        } else {
            if (!container.classList.contains("tldreveal-inactive")) {
                container.classList.add("tldreveal-inactive")
            }
            if (container.hasAttribute("data-prevent-swipe")) {
                container.removeAttribute("data-prevent-swipe")
            }
        }
    }, [ isShown, isEditing ])

    function handleDKey() {
        setIsEditing(true)
    }

    const handleKeydown = (state = { isEditing }) => (event: KeyboardEvent) => {
        if (state.isEditing && event.key === "Escape") {
            setIsEditing(false)
            event.stopImmediatePropagation()
        }
    }

    const handleDblclick = (state = { isEditing }) => (event: MouseEvent) => {
        if (!state.isEditing) {
            event.preventDefault()
            setIsEditing(true)
        }
    }
    const handleStylusdown = (state = { isEditing }) => (event) => {
        if(!state.isEditing) {
            // if we're touching with a stylus
            if(event.touches !== undefined && event.touches[0].touchType === "stylus") {
               // 1. enter editing mode 
               // TODO: 2. resend event appropriately to start writing
                    event.preventDefault()
                    setIsEditing(true)
            }
        }
    }

    const handleFingerdown = (state = { isEditing }) => {
        if(!state.isEditing) {
            let lastTap = Date.now()
            return (event) => {
                // if this is not a stylus tap
                if(!(event.touches !== undefined && event.touches[0].touchType === "stylus")) {
                    const now = Date.now()
                    // if it's our second in 500ms enter editing mode
                    // ignore second taps within 100ms, as they're usually different fingers making a multi-touch gesture like pinch-to-zoom
                    if (lastTap + 100 <= now && now < lastTap + 500) { 
                        event.preventDefault()
                        setIsEditing(true) 
                    }
                    lastTap = now;
                }
            }
        }
    }
    
    useEffect(() => {
        const state = { isEditing }
        const handleKeydown_    = handleKeydown(state)
        const handleDblclick_   = handleDblclick(state)
        const handleStylusdown_ = handleStylusdown(state)
        const handleFingerdown_ = handleFingerdown(state)

        reveal.addKeyBinding({ keyCode: 68, key: "D", description: "Enter drawing mode" }, handleDKey)
        window.addEventListener("dblclick", handleDblclick_, true)
        window.addEventListener("touchstart", handleStylusdown_, true)
        window.addEventListener("touchstart", handleFingerdown_, true)
        window.addEventListener("keydown", handleKeydown_, true)
        return () => {
            reveal.removeKeyBinding(68)
            window.removeEventListener("dblclick", handleDblclick_, true)
            window.removeEventListener("touchstart", handleStylusdown_, true)
            window.removeEventListener("touchstart", handleFingerdown_, true)
            window.removeEventListener("keydown", handleKeydown_, true)
        }
    }, [ isEditing ])

    function handleReady(event) {
        setCurrentSlide({ h: event.indexh, v: event.indexv })
    }
    
    const handleSlidechanged = (state = { currentSlideId }) => event => {
        const currentTransition: string | undefined = 
            reveal.getConfig().transition 
            || event.currentSlide.getAttribute("data-transition")
        const noTransition = currentTransition === "none" || currentTransition?.includes("none-in")
        const hasSameSlideId = getSlideId({ h: event.indexh, v: event.indexv }) === state.currentSlideId
        if (noTransition || hasSameSlideId) {
            setCurrentSlide({ h: event.indexh, v: event.indexv })
        } else {
            container.classList.toggle("start-transition", true)
            setTimeout(() => {
                setCurrentSlide({ h: event.indexh, v: event.indexv })
                container.classList.toggle("transitioning", true)
            }, 200)
        }
    }
    
    function handleSlidetransitionend(_event) {
        container.classList.toggle("start-transition", false)
        container.classList.toggle("transitioning", false)
    }
    
    function handleOverviewshown(_event) {
        setIsShown(false)
    }
    
    function handleOverviewhidden(_event) {
        setIsShown(true)
    }

    function handlePaused(_event) {
        setIsShown(false)
    }

    function handleResumed(_event) {
        setIsShown(true)
    }
    
    useEffect(() => {
        reveal.on("ready", handleReady)
        // beforeslidechange
        reveal.on("slidetransitionend", handleSlidetransitionend)
        reveal.on("overviewshown", handleOverviewshown)
        reveal.on("overviewhidden", handleOverviewhidden)
        reveal.on("paused", handlePaused)
        reveal.on("resumed", handleResumed)
        return () => {
            reveal.off("ready", handleReady)
            reveal.off("overviewshown", handleOverviewshown)
            reveal.off("overviewhidden", handleOverviewhidden)
            reveal.off("paused", handlePaused)
            reveal.off("resumed", handleResumed)
        }
    }, [])
    
    useEffect(() => {
        const handleSlidechanged_ = handleSlidechanged({ currentSlideId })
        reveal.on("slidechanged", handleSlidechanged_)
        return () => {
            reveal.off("slidechanged", handleSlidechanged_)
        }
    }, [ currentSlideId ])

    const handleResize = (state = { editor }) => {
        // Run both a throttled and debounced version: the throttled function
        // handles the in-between values, without completely flooding tldraw
        // with zoom requests; the debounced version then waits until the final
        // dimensions have been reached and everything is stabilised to make
        // sure the final adjustement puts it in the right position.
        const throttled = throttle(() => syncEditorBounds(state), 100)
        const debounced = debounce(() => syncEditorBounds(state), 500)
        return () => {
            throttled()
            debounced()
        }
    }

    useEffect(() => {
        const state = { editor }
        const handleResize_ = handleResize(state)

        window.addEventListener("resize", handleResize_)
        return () => {
            window.removeEventListener("resize", handleResize_)
        }
    }, [ editor ])

    function syncEditorBounds(state = { editor }) {
        if (state.editor) {
            // Set the correct zoom and prevent further movement
            state.editor.setCameraOptions({...state.editor.getCameraOptions(), isLocked: false })
            state.editor.zoomToBounds(bounds, { inset: 0 })
            state.editor.setCameraOptions({...state.editor.getCameraOptions(), isLocked: true })
        }
    }

    function syncEditor(state = { editor, currentSlide }) {
        if (state.editor) {
            // Find the correct page, or create it if there isn't one
            const pageId = PageRecordType.createId(currentSlideId)
            if (!state.editor.getPage(pageId)) {
                state.editor.createPage({ id: pageId, name: currentSlideId })
            }

            // Navigate to the correct page if we're not there yet, and delete
            // the previous page if it is empty
            const oldCurrentPageId = state.editor.getCurrentPageId()
            if (oldCurrentPageId !== pageId) {
                // Delete the old current page if it has no shapes on it
                const deleteOldCurrent = 
                    state.editor.getCurrentPageShapeIds().size === 0

                state.editor.setCurrentPage(pageId)
                // Reset undo/redo to prevent undoing changes on other pages
                state.editor.history.clear()

                if (deleteOldCurrent) {
                    state.editor.deletePage(oldCurrentPageId)
                }
            }

            if (config.automaticDarkMode) {
                const currentSlideClasses = 
                reveal.getSlide(currentSlide.h, currentSlide.v).classList
                if (currentSlideClasses.contains("has-dark-background")) {
                    userPreferences.update(u => ({ ...u, isDarkMode: true }))
                } else if (currentSlideClasses.contains("has-light-background")) {
                    userPreferences.update(u => ({ ...u, isDarkMode: false }))
                } else {
                    userPreferences.update(u => ({ ...u, isDarkMode: config.isDarkMode }))
                }
            }

            // Set the bounds correctly on the new page
            syncEditorBounds(state)
        }
    }

    useEffect(() => {
        syncEditor({ editor, currentSlide })
    }, [ editor, currentSlide ])

    const customTranslations = {
        en: {
            "tldreveal.menu.file": "File",
            "tldreveal.menu.clear": "Clear",
            "tldreveal.action.close": "Exit drawing mode",
            "tldreveal.action.open": "Enter drawing mode",
            "tldreveal.action.save-file": "Save file",
            "tldreveal.action.clear-localstorage": "Clear browser storage",
            "tldreveal.action.clear-page": "Clear current slide",
            "tldreveal.action.clear-deck": "Clear deck",

            "tldreveal.options.save-to-localstorage": "Save in browser",

            // Set the default name for built-in export functions
            "document.default-name": deckId || "unknown"
        }
    }

    const customActions : TLUiActionsContextType = {
        ["tldreveal.close"]: {
            id: "tldreveal.close",
            label: "tldreveal.action.close",
            icon: "cross-2",
            readonlyOk: true,
            async onSelect(_source) {
                // this is how 'action.exit-pen-mode' defined in tldraw/ui/context/actions.tsx exits pen mode. 
                // Is this the right way to do it? Should we be using that action instead?
                editor.updateInstanceState({ isPenMode: false })
                setIsEditing(false)
            }
        },
        ["tldreveal.open"]: {
            id: "tldreveal.open",
            label: "tldreveal.action.open",
            readonlyOk: true,
            async onSelect(_source) {
                setIsEditing(true)
            }
        },
        ["tldreveal.save-file"]: {
            id: "tldreveal.save-file",
            label: "tldreveal.action.save-file",
            readonlyOk: true,
            kbd: "$s",
            async onSelect(_source) {
                const snapshot = getTimestampedSnapshot(store)
                await fileSave(new Blob([ JSON.stringify(snapshot) ]), {
                    fileName: (deckId || "untitled") + TLDREVEAL_FILE_EXTENSION, 
                    extensions: [ TLDREVEAL_FILE_EXTENSION ]
                })
            }
        },
        ["tldreveal.toggle-save-to-localstorage"]: {
            id: "tldreveal.toggle-save-to-localstorage",
            label: "tldreveal.options.save-to-localstorage",
            readonlyOk: true,
            checkbox: true,
            async onSelect(_source) {
                setSaveToLocalStorage(localStorageKey && !saveToLocalStorage)
            }
        },
        ["tldreveal.clear-localstorage"]: {
            id: "tldreveal.clear-localstorage",
            label: "tldreveal.action.clear-localstorage",
            async onSelect(_source) {
                if (localStorageKey) {
                    setSaveToLocalStorage(false)
                    localStorage.removeItem(localStorageKey)
                }
            }
        },
        ["tldreveal.clear-page"]: {
            id: "tldreveal.clear-page",
            label: "tldreveal.action.clear-page",
            async onSelect(_source) {
                transact(() => {
                    // Delete all shapes on the current page
                    editor.deleteShapes(editor.getCurrentPageShapes())
                })
            }
        },
        ["tldreveal.clear-deck"]: {
            id: "tldreveal.clear-deck",
            label: "tldreveal.action.clear-deck",
            async onSelect(_source) {
                transact(() => {
                    // Find all shapes from the store and delete them
                    const allShapeIds = 
                        store.allRecords()
                            .filter(record => record.typeName === "shape")
                            .map(record => record.id as TLShapeId)
                    editor.deleteShapes(allShapeIds)

                    // Delete all assets
                    editor.deleteAssets(editor.getAssets())

                    // Delete all pages except the current
                    const currentPage = editor.getCurrentPage()
                    for (const page of editor.getPages()) {
                        if (page.id !== currentPage.id) editor.deletePage(page)
                    }
                })
            }
        }
    }

    /*
     * History Playback Stuff
     * based on https://gist.github.com/steveruizok/232e9bf621e3d2dfaebd4f198c7e69fc
     */
    function HistorySlider() {
        const diffs = useRef<RecordsDiff<TLRecord>[]>([])
        const pointer = useRef(0)
        const editor = useEditor()

        const handleSliderChange = (e) => {
            const events = diffs.current
            const curr = pointer.current
            const prevPct = curr / 10000

            const next = e.currentTarget.value
            const nextPct = next / 10000

            const prevIndex = Math.ceil(prevPct * diffs.current.length)
            const nextIndex = Math.ceil(nextPct * diffs.current.length)

            if (nextPct === 1 && editor.getInstanceState().isReadonly) {
                editor.updateInstanceState({ isReadonly: false })
            } else if (nextPct < 1 && !editor.getInstanceState().isReadonly) {
                editor.updateInstanceState({ isReadonly: true })
            }

            pointer.current = next

            editor.store.mergeRemoteChanges(() => {
                if (nextIndex > prevIndex) {
                    // console.log('redoing', prevIndex, nextIndex)
                    for (let i = prevIndex; i <= nextIndex; i++) {
                        const changes = events[i]
                        if (!changes) continue

                        Object.values(changes.added).forEach((record) => {
                            editor.store.put([record])
                        })

                        Object.values(changes.updated).forEach(([prev, next]) => {
                            editor.store.put([next])
                        })

                        Object.values(changes.removed).forEach((record) => {
                            editor.store.remove([record.id])
                        })
                    }
                } else if (nextIndex < prevIndex) {
                    // console.log('undoing', prevIndex, nextIndex)
                    for (let i = prevIndex; i >= nextIndex; i--) {
                        const changes = events[i]
                        if (!changes) continue

                        Object.values(changes.added).forEach((record) => {
                            editor.store.remove([record.id])
                        })

                        Object.values(changes.updated).forEach(([prev, next]) => {
                            editor.store.put([prev])
                        })

                        Object.values(changes.removed).forEach((record) => {
                            editor.store.put([record])
                        })
                    }
                }
            })
        }

        useEffect(() => {
            return editor.store.listen(({ changes }) => diffs.current.push(changes), {
                source: 'user',
                scope: 'document',
            })
        }, [editor])

        return (
            <input
                type="range"
                defaultValue="10000"
                onChange={handleSliderChange}
                style={{
                    position: 'absolute',
                    top: 64,
                    left: 8,
                    width: 300,
                    zIndex: 999,
                }}
                min="0"
                max="10000"
            />
        )
    }
    
    function PlaybackPanel() {
        const editor = useEditor()
        return (
            <TldrawUiPopover id="playback menu">
                <TldrawUiPopoverTrigger>
                    <TldrawUiButton
                        type="tool"
                        data-testid="mobile-styles.button"
                        title={'Playback'}
                        disabled={false}
                    >
                        <TldrawUiButtonIcon
                            icon={'cross-2'}
                        />
                    </TldrawUiButton>
                </TldrawUiPopoverTrigger>
                <TldrawUiPopoverContent side="top" align="end">
                    <HistorySlider/>
                </TldrawUiPopoverContent>
            </TldrawUiPopover>
        )
    }

    // Other Toolbar Content
    // This is similar to the default, but with 
    // 1. a few items shuffled
    // 2. the hand gone
    // 3. the most commonly-chosen items set up so, 
    //    when you touch them with a finger, you exit pen mode
    const possiblyExitPenMode = (e) => {
        if(!(e.touches !== undefined && e.touches[0].touchType === "stylus")) {
            editor.updateInstanceState({ isPenMode: false })
        }
    }
    const pemp = function(f) {
        return function(...args) : JSX.Element {
            return (
            <div onTouchStart={possiblyExitPenMode}>
                { f(...args) }
            </div> 
            )
        }
    }
    const CustomSelectToolbarItem = pemp(SelectToolbarItem)
    const CustomEraserToolbarItem = pemp(EraserToolbarItem)
    const CustomDrawToolbarItem = pemp(DrawToolbarItem)
    const CustomHighlightToolbarItem = pemp(HighlightToolbarItem)
    const CustomLaserToolbarItem = pemp(LaserToolbarItem)
    const removeTools = ['hand'];

    function CustomToolbarContent() {
        return (
        <>
            <CustomSelectToolbarItem />
            <CustomEraserToolbarItem />
            <CustomDrawToolbarItem />
            <CustomHighlightToolbarItem />
            <CustomLaserToolbarItem />
            <ArrowToolbarItem />
            <TextToolbarItem />
            <LineToolbarItem />
            <NoteToolbarItem />
            <AssetToolbarItem />
            <RectangleToolbarItem />
            <EllipseToolbarItem />
            <TriangleToolbarItem />
            <DiamondToolbarItem />
            <HexagonToolbarItem />
            <OvalToolbarItem />
            <RhombusToolbarItem />
            <StarToolbarItem />
            <CloudToolbarItem />
            <XBoxToolbarItem />
            <CheckBoxToolbarItem />
            <ArrowLeftToolbarItem />
            <ArrowUpToolbarItem />
            <ArrowDownToolbarItem />
            <ArrowRightToolbarItem />
            </>
        )
    }

    /* Broken due to import issues
    *
    // Set up toolbar to inclide playback panel
    // copy/pasted from ui/components/Toolbar/DefaultToolbar.tsx
    // then modified to include one new element---the playback panel---at the end
    const CustomToolbar = memo(function DefaultToolbar({ children }: DefaultToolbarProps) {
        const editor = useEditor()
        const breakpoint = useBreakpoint()
        const isReadonlyMode = useReadonly()
        const activeToolId = useValue('current tool id', () => editor.getCurrentToolId(), [editor])

        const { ActionsMenu, QuickActions } = useTldrawUiComponents()

        return (
            <div className="tlui-toolbar">
                <div className="tlui-toolbar__inner">
                    <div className="tlui-toolbar__left">
                        {!isReadonlyMode && (
                            <div className="tlui-toolbar__extras">
                                {breakpoint < PORTRAIT_BREAKPOINT.TABLET && (
                                    <div className="tlui-toolbar__extras__controls tlui-buttons__horizontal">
                                        {QuickActions && <QuickActions />}
                                        {ActionsMenu && <ActionsMenu />}
                                    </div>
                                )}
                                <ToggleToolLockedButton activeToolId={activeToolId} />
                            </div>
                        )}
                        <OverflowingToolbar>{children ?? <CustomToolbarContent />}</OverflowingToolbar>
                    </div>
                    {breakpoint < PORTRAIT_BREAKPOINT.TABLET_SM && !isReadonlyMode && (
                        <div className="tlui-toolbar__tools">
                            <MobileStylePanel />
                            <PlaybackPanel />
                        </div>
                    )}
                </div>
            </div>
        )
    })
    */
    function CustomToolbar() {
        return (
            <DefaultToolbar>
                <CustomToolbarContent />
                <PlaybackPanel />
            </DefaultToolbar>
        )
    }

    

    if (isReady) {
        return (
            <Tldraw
                forceMobile
                hideUi={!isEditing} 
                store={store}
                user={isolatedUser}
                onMount={onTldrawMount}
                components={{
                    PageMenu: null,
                    MainMenu: () => CustomMainMenu({ 
                        fileProps: { 
                            canUseLocalStorage: localStorageKey !== undefined, 
                            saveToLocalStorage
                        },
                    }),
                    Toolbar: CustomToolbar,
                    ActionsMenu: CustomActionsMenu,
                    QuickActions: CustomQuickActions
                }}
                overrides={{
                    translations: customTranslations,
                    tools(editor, tools) {
                     // Remove the keyboard shortcuts for the removed tools.
                     removeTools.forEach(tool => tools[tool].kbd = undefined)
                     return tools
                    }, 
                    // Remove actions related to zooming
                    actions(editor, actions) {
                        delete actions["select-zoom-tool"]
                        delete actions["zoom-in"]
                        delete actions["zoom-out"]
                        delete actions["zoom-to-100"]
                        delete actions["zoom-to-fit"]
                        delete actions["zoom-to-selection"]
                        delete actions["back-to-content"]
                        return { ...actions, ...customActions }
                    }
                }}
                >
               { /* <HistorySlider /> */ }
            </Tldraw>
        )
    }
}
