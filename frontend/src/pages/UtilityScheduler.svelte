<script lang="ts">
	import { afterUpdate, onMount, tick } from "svelte";

	import { loadSchedulerData } from "../lib/scheduler/data";
	import {
		computeSchedulerGraph,
		detangleCourseOrder,
	} from "../lib/scheduler/logic";
	import type {
		CourseCatalog,
		CourseInstance,
		PrereqEdge,
		Requirement,
		ScheduleFile,
	} from "../lib/scheduler/types";

	type EdgeSegment = {
		id: string;
		x1: number;
		y1: number;
		x2: number;
		y2: number;
		status: PrereqEdge["status"];
		dimmed: boolean;
		highlighted: boolean;
	};

	let loading = true;
	let error: string | null = null;

	let semesterOrder: string[] = [];
	let semesterToIndex: Record<string, number> = {};
	let courseCatalog: CourseCatalog = {};
	let coursesById: Record<string, CourseInstance> = {};
	let columnCourseIds: Record<string, string[]> = {};
	let prereqsByCourseId: Record<
		string,
		{ courseChoices: string[]; canBeConcurrent: boolean }[]
	> = {};

	let prerequisiteEdges: PrereqEdge[] = [];
	let requirementProgressByCourseId: Record<string, number> = {};

	let selectedCourseId: string | null = null;
	let selectedCourseData: CourseInstance | null = null;
	let draggedCourseId: string | null = null;
	let dragOverSemester: string | null = null;

	let boardElement: HTMLDivElement | null = null;
	let courseElements: Record<string, HTMLDivElement | null> = {};
	let edgeSegments: EdgeSegment[] = [];
	let nonInvalidEdgeSegments: EdgeSegment[] = [];
	let invalidEdgeSegments: EdgeSegment[] = [];
	let edgeMeasureQueued = false;

	let semesterCredits: Record<string, number> = {};
	let selectedCourseResolved: CourseInstance | null = null;
	let selectedCourseRequirementGroups: {
		courseChoices: string[];
		canBeConcurrent: boolean;
	}[] = [];

	let addCourseQuery = "";
	let addSemester = "";
	let addCourseError: string | null = null;
	let addCourseSuccess: string | null = null;
	let dataTransferMessage: string | null = null;
	let importInputElement: HTMLInputElement | null = null;

	const PRECOLLEGE_SEMESTER = "precollege";

	function normalizeCourseKey(value: string): string {
		return value.toLowerCase().replace(/[^a-z0-9]/g, "");
	}

	function compactDisplayCode(courseName: string): string {
		const firstDigitIndex = courseName.search(/\d/);
		if (firstDigitIndex < 0) {
			return courseName.replace(/\s+/g, " ").trim();
		}

		const prefix = courseName
			.slice(0, firstDigitIndex)
			.replace(/[^A-Za-z]/g, "");
		const suffix = courseName
			.slice(firstDigitIndex)
			.replace(/\s+/g, " ")
			.trim();
		return `${prefix} ${suffix}`.trim();
	}

	$: normalizedAddQuery = addCourseQuery.trim().toLowerCase();
	$: normalizedCompactQuery = normalizeCourseKey(addCourseQuery.trim());
	$: catalogSuggestions = Object.entries(courseCatalog)
		.filter(([name, item]) => {
			if (!normalizedAddQuery) {
				return true;
			}

			const normalizedName = name.toLowerCase();
			const compactName = normalizeCourseKey(name);
			const normalizedTitle = item.title.toLowerCase();

			return (
				normalizedName.includes(normalizedAddQuery) ||
				normalizedTitle.includes(normalizedAddQuery) ||
				compactName.includes(normalizedCompactQuery)
			);
		})
		.sort(([aName], [bName]) => aName.localeCompare(bName))
		.slice(0, 20)
		.map(([name, item]) => ({
			name,
			title: item.title,
			display: `${name}: ${item.title}`,
		}));

	$: catalogSuggestionValues = catalogSuggestions.flatMap((item) => {
		const primary = `${item.name}: ${item.title}`;
		const compactCode = compactDisplayCode(item.name);
		const compactDisplay = `${compactCode}: ${item.title}`;

		if (compactCode === item.name) {
			return [primary];
		}

		return [primary, compactDisplay];
	});

	$: if (!addSemester && semesterOrder.length > 0) {
		addSemester = semesterOrder[0];
	}

	function setSelectedCourse(courseId: string, source: string): void {
		const exists = !!coursesById[courseId];
		selectedCourseId = courseId;
		if (exists) {
			selectedCourseData = coursesById[courseId];
		}
	}

	function trackCourseElement(
		node: HTMLElement,
		courseId: string,
	): { update: (nextCourseId: string) => void; destroy: () => void } {
		let currentCourseId = courseId;
		setCourseElement(currentCourseId, node as HTMLDivElement);

		return {
			update: (nextCourseId: string) => {
				if (nextCourseId === currentCourseId) {
					return;
				}
				setCourseElement(currentCourseId, null);
				currentCourseId = nextCourseId;
				setCourseElement(currentCourseId, node as HTMLDivElement);
			},
			destroy: () => setCourseElement(currentCourseId, null),
		};
	}

	function setCourseElement(
		courseId: string,
		element: HTMLDivElement | null,
	): void {
		courseElements = {
			...courseElements,
			[courseId]: element,
		};
	}

	function refreshSemesterCredits(): void {
		const nextCredits: Record<string, number> = {};
		for (const semester of semesterOrder) {
			const total = (columnCourseIds[semester] ?? []).reduce(
				(sum, courseId) => {
					return sum + (coursesById[courseId]?.credits ?? 0);
				},
				0,
			);
			nextCredits[semester] = total;
		}
		semesterCredits = nextCredits;
	}

	function updateGraph(useDetangle: boolean): void {
		const graph = computeSchedulerGraph({
			coursesById,
			prereqsByCourseId,
			semesterToIndex,
		});

		prerequisiteEdges = graph.edges;
		requirementProgressByCourseId = graph.requirementProgressByCourseId;

		if (useDetangle) {
			columnCourseIds = detangleCourseOrder(
				semesterOrder,
				columnCourseIds,
				prerequisiteEdges,
			);
		}
		refreshSemesterCredits();
	}

	function updateEdgeSegments(): void {
		if (!boardElement) {
			edgeSegments = [];
			return;
		}

		const boardRect = boardElement.getBoundingClientRect();

		const nextSegments = prerequisiteEdges
			.map((edge) => {
				const fromElement = courseElements[edge.fromCourseId];
				const toElement = courseElements[edge.toCourseId];
				if (!fromElement || !toElement) {
					return null;
				}

				const fromRect = fromElement.getBoundingClientRect();
				const toRect = toElement.getBoundingClientRect();

				const isConcurrent = edge.requirement.canBeConcurrent;
				const fromX = isConcurrent
					? fromRect.left - boardRect.left + fromRect.width / 2
					: fromRect.left - boardRect.left + fromRect.width * 0.75;
				const toX = isConcurrent
					? toRect.left - boardRect.left + toRect.width / 2
					: toRect.left - boardRect.left + toRect.width * 0.25;
				const fromY =
					fromRect.top - boardRect.top + fromRect.height / 2;
				const toY = toRect.top - boardRect.top + toRect.height / 2;

				const hasSelection = !!selectedCourseId;
				const relatedToSelection =
					!!selectedCourseId &&
					(selectedCourseId === edge.fromCourseId ||
						selectedCourseId === edge.toCourseId);
				const alwaysHighlightInvalid = edge.status === "invalid";
				const highlighted =
					alwaysHighlightInvalid || relatedToSelection;
				const dimmed =
					!alwaysHighlightInvalid &&
					(!hasSelection || !relatedToSelection);

				return {
					id: edge.id,
					x1: fromX,
					y1: fromY,
					x2: toX,
					y2: toY,
					status: edge.status,
					dimmed,
					highlighted,
				} satisfies EdgeSegment;
			})
			.filter((segment): segment is EdgeSegment => segment !== null);

		edgeSegments = nextSegments;
	}

	$: nonInvalidEdgeSegments = edgeSegments.filter(
		(segment) => segment.status !== "invalid",
	);
	$: invalidEdgeSegments = edgeSegments.filter(
		(segment) => segment.status === "invalid",
	);

	function queueEdgeMeasurement(): void {
		if (edgeMeasureQueued) {
			return;
		}

		edgeMeasureQueued = true;
		requestAnimationFrame(() => {
			edgeMeasureQueued = false;
			updateEdgeSegments();
		});
	}

	async function recalculateLayout(useDetangle: boolean): Promise<void> {
		updateGraph(useDetangle);
		await tick();
		queueEdgeMeasurement();
	}

	function buildRequirementsForCourse(courseName: string): Requirement[] {
		const catalogItem = courseCatalog[courseName];
		if (!catalogItem) {
			return [];
		}

		const requirements: Requirement[] = [];
		for (const group of catalogItem.prereqs ?? []) {
			requirements.push({ courseChoices: group, canBeConcurrent: false });
		}
		for (const group of catalogItem.concurrent_prereqs ?? []) {
			requirements.push({ courseChoices: group, canBeConcurrent: true });
		}

		return requirements;
	}

	function defaultCourseCredits(courseName: string): number {
		const item = courseCatalog[courseName];
		if (!item) {
			throw new Error(
				`Course '${courseName}' not found in course catalog.`,
			);
		}
		if (typeof item.credits === "number") {
			return item.credits;
		}
		return item.min_credits ?? 0;
	}

	function getValidCredits(courseName: string): number[] {
		const item = courseCatalog[courseName];
		if (!item) {
			return [];
		}

		if (typeof item.credits === "number") {
			return [item.credits];
		}

		return Array.from(
			{
				length: Math.max(
					1,
					(item.max_credits ?? item.min_credits ?? 0) -
						(item.min_credits ?? 0) +
						1,
				),
			},
			(_, idx) => (item.min_credits ?? 0) + idx,
		);
	}

	function validateCourseCredits(
		courseName: string,
		requestedCredits?: number,
	): number {
		const item = courseCatalog[courseName];
		if (!item) {
			throw new Error(
				`Course '${courseName}' not found in course catalog.`,
			);
		}

		const validCredits = getValidCredits(courseName);

		if (requestedCredits === undefined) {
			return validCredits[0];
		}

		if (!validCredits.includes(requestedCredits)) {
			throw new Error(
				`Course '${courseName}' requested with ${requestedCredits} credits, valid options: ${validCredits.join(", ")}`,
			);
		}

		return requestedCredits;
	}

	function parseCourseEntry(entry: string): {
		courseName: string;
		requestedCredits?: number;
	} {
		if (!entry.includes("[")) {
			return { courseName: entry.trim() };
		}

		if (!entry.endsWith("]")) {
			throw new Error(
				`Malformed course entry '${entry}': bracket not closed.`,
			);
		}

		const bracketPos = entry.lastIndexOf("[");
		const courseName = entry.slice(0, bracketPos).trim();
		const creditPart = entry.slice(bracketPos + 1, -1).trim();
		const requestedCredits = Number.parseInt(creditPart, 10);
		if (Number.isNaN(requestedCredits)) {
			throw new Error(
				`Malformed course entry '${entry}': invalid credit value.`,
			);
		}

		return { courseName, requestedCredits };
	}

	function nextOccurrenceIndex(courseName: string): number {
		let maxOccurrence = 0;
		for (const course of Object.values(coursesById)) {
			if (course.name === courseName) {
				maxOccurrence = Math.max(maxOccurrence, course.occurrenceIndex);
			}
		}
		return maxOccurrence + 1;
	}

	function resolveCourseNameFromQuery(): string | null {
		const candidate = addCourseQuery.trim();
		if (!candidate) {
			return null;
		}

		const fromDisplay = candidate.includes(":")
			? candidate.slice(0, candidate.indexOf(":")).trim()
			: candidate;

		if (courseCatalog[fromDisplay]) {
			return fromDisplay;
		}

		const exactCaseInsensitive = Object.keys(courseCatalog).find(
			(courseName) =>
				courseName.toLowerCase() === fromDisplay.toLowerCase(),
		);
		if (exactCaseInsensitive) {
			return exactCaseInsensitive;
		}

		const compactCandidate = normalizeCourseKey(fromDisplay);
		const compactMatch = Object.keys(courseCatalog).find(
			(courseName) => normalizeCourseKey(courseName) === compactCandidate,
		);
		if (compactMatch) {
			return compactMatch;
		}

		const exactDisplayMatch = catalogSuggestions.find(
			(item) => item.display.toLowerCase() === candidate.toLowerCase(),
		);
		if (exactDisplayMatch) {
			return exactDisplayMatch.name;
		}

		if (catalogSuggestions.length === 1) {
			return catalogSuggestions[0].name;
		}

		return null;
	}

	function addCourseToSemester(): void {
		addCourseError = null;
		addCourseSuccess = null;
		dataTransferMessage = null;

		const courseName = resolveCourseNameFromQuery();
		if (!courseName) {
			addCourseError =
				"Pick a course from the search results before adding.";
			return;
		}

		if (!addSemester || !semesterOrder.includes(addSemester)) {
			addCourseError = "Select a valid target semester.";
			return;
		}

		const occurrenceIndex = nextOccurrenceIndex(courseName);
		const courseId = `${courseName}__${occurrenceIndex}`;
		const credits = defaultCourseCredits(courseName);

		const newCourse: CourseInstance = {
			id: courseId,
			name: courseName,
			occurrenceIndex,
			semester: addSemester,
			credits,
			title: courseCatalog[courseName]?.title ?? courseName,
		};

		coursesById = {
			...coursesById,
			[courseId]: newCourse,
		};

		columnCourseIds = {
			...columnCourseIds,
			[addSemester]: [...(columnCourseIds[addSemester] ?? []), courseId],
		};

		prereqsByCourseId = {
			...prereqsByCourseId,
			[courseId]: buildRequirementsForCourse(courseName),
		};

		setSelectedCourse(courseId, "add-course");
		addCourseQuery = courseName;
		addCourseSuccess = `Added ${courseName} to ${addSemester}.`;
		void recalculateLayout(false);
	}

	function buildScheduleExport(): ScheduleFile {
		const semesters: Record<string, string[]> = {};

		const precollegeEntries = Object.values(coursesById)
			.filter((course) => course.semester === PRECOLLEGE_SEMESTER)
			.sort((a, b) => a.occurrenceIndex - b.occurrenceIndex)
			.map((course) => {
				const defaultCredits = defaultCourseCredits(course.name);
				return course.credits === defaultCredits
					? course.name
					: `${course.name}[${course.credits}]`;
			});

		if (precollegeEntries.length > 0) {
			semesters[PRECOLLEGE_SEMESTER] = precollegeEntries;
		}

		for (const semester of semesterOrder) {
			const entries = (columnCourseIds[semester] ?? []).map(
				(courseId) => {
					const course = coursesById[courseId];
					if (!course) {
						return null;
					}

					const defaultCredits = defaultCourseCredits(course.name);
					return course.credits === defaultCredits
						? course.name
						: `${course.name}[${course.credits}]`;
				},
			);

			semesters[semester] = entries.filter(
				(entry): entry is string => !!entry,
			);
		}

		return { semesters };
	}

	function handleExportJson(): void {
		const exportData = buildScheduleExport();
		const blob = new Blob([JSON.stringify(exportData, null, 2)], {
			type: "application/json",
		});

		const url = URL.createObjectURL(blob);
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = "schedule-export.json";
		anchor.click();
		URL.revokeObjectURL(url);

		dataTransferMessage =
			"Exported current schedule to schedule-export.json";
	}

	async function applyImportedSchedule(
		scheduleFile: ScheduleFile,
	): Promise<void> {
		const importedSemesters = Object.keys(scheduleFile.semesters ?? {});
		const importedOrder = importedSemesters.filter(
			(semester) => semester !== PRECOLLEGE_SEMESTER,
		);

		if (importedOrder.length === 0) {
			throw new Error(
				"Imported schedule must include at least one non-precollege semester.",
			);
		}

		const nextSemesterToIndex: Record<string, number> = {
			[PRECOLLEGE_SEMESTER]: -1,
		};
		importedOrder.forEach((semester, index) => {
			nextSemesterToIndex[semester] = index;
		});

		const nextCoursesById: Record<string, CourseInstance> = {};
		const nextColumnCourseIds: Record<string, string[]> =
			Object.fromEntries(
				importedOrder.map((semester) => [semester, [] as string[]]),
			);
		const nextPrereqsByCourseId: Record<string, Requirement[]> = {};
		const nextOccurrenceCounts: Record<string, number> = {};

		for (const [semester, entries] of Object.entries(
			scheduleFile.semesters ?? {},
		)) {
			if (
				semester !== PRECOLLEGE_SEMESTER &&
				!importedOrder.includes(semester)
			) {
				continue;
			}

			for (const entry of entries) {
				const { courseName, requestedCredits } =
					parseCourseEntry(entry);
				if (!courseCatalog[courseName]) {
					throw new Error(
						`Course '${courseName}' is not in the loaded course catalog.`,
					);
				}

				const occurrenceIndex =
					(nextOccurrenceCounts[courseName] ?? 0) + 1;
				nextOccurrenceCounts[courseName] = occurrenceIndex;

				const courseId = `${courseName}__${occurrenceIndex}`;
				const credits = validateCourseCredits(
					courseName,
					requestedCredits,
				);
				const createdCourse: CourseInstance = {
					id: courseId,
					name: courseName,
					occurrenceIndex,
					semester,
					credits,
					title: courseCatalog[courseName]?.title ?? courseName,
				};

				nextCoursesById[courseId] = createdCourse;
				nextPrereqsByCourseId[courseId] =
					buildRequirementsForCourse(courseName);

				if (semester !== PRECOLLEGE_SEMESTER) {
					nextColumnCourseIds[semester].push(courseId);
				}
			}
		}

		semesterOrder = importedOrder;
		semesterToIndex = nextSemesterToIndex;
		coursesById = nextCoursesById;
		columnCourseIds = nextColumnCourseIds;
		prereqsByCourseId = nextPrereqsByCourseId;
		selectedCourseId = null;
		selectedCourseData = null;

		addSemester = importedOrder[0] ?? "";
		await recalculateLayout(true);
	}

	async function handleImportFile(event: Event): Promise<void> {
		addCourseError = null;
		addCourseSuccess = null;
		dataTransferMessage = null;

		const target = event.currentTarget as HTMLInputElement;
		const file = target.files?.[0];
		if (!file) {
			return;
		}

		try {
			const text = await file.text();
			const parsed = JSON.parse(text) as ScheduleFile;
			if (!parsed || typeof parsed !== "object" || !parsed.semesters) {
				throw new Error(
					"Invalid schedule JSON format. Expected an object with a semesters field.",
				);
			}

			await applyImportedSchedule(parsed);
			dataTransferMessage = `Imported schedule from ${file.name}`;
		} catch (importError) {
			addCourseError =
				importError instanceof Error
					? importError.message
					: "Failed to import schedule JSON.";
		} finally {
			target.value = "";
		}
	}

	function moveCourse(
		courseId: string,
		targetSemester: string,
		targetIndex?: number,
	): void {
		const course = coursesById[courseId];
		if (!course) {
			return;
		}

		const sourceSemester = course.semester;
		if (
			!columnCourseIds[sourceSemester] ||
			!columnCourseIds[targetSemester]
		) {
			return;
		}

		const sourceIds = [...columnCourseIds[sourceSemester]];
		const sourceIndex = sourceIds.indexOf(courseId);
		if (sourceIndex < 0) {
			return;
		}
		sourceIds.splice(sourceIndex, 1);

		const destinationIds =
			sourceSemester === targetSemester
				? sourceIds
				: [...columnCourseIds[targetSemester]];

		let destinationIndex =
			typeof targetIndex === "number"
				? Math.max(0, Math.min(targetIndex, destinationIds.length))
				: destinationIds.length;

		if (
			sourceSemester === targetSemester &&
			typeof targetIndex === "number" &&
			targetIndex > sourceIndex
		) {
			destinationIndex -= 1;
		}

		destinationIds.splice(destinationIndex, 0, courseId);

		columnCourseIds = {
			...columnCourseIds,
			[sourceSemester]: sourceIds,
			[targetSemester]: destinationIds,
		};

		const updatedCourse = {
			...course,
			semester: targetSemester,
		};

		coursesById = {
			...coursesById,
			[courseId]: updatedCourse,
		};

		if (selectedCourseId === courseId) {
			selectedCourseData = updatedCourse;
		}

		// Keep manual drop order deterministic by skipping automatic detangling after drag-drop.
		void recalculateLayout(false);
	}

	function handleCourseSelect(courseId: string): void {
		setSelectedCourse(courseId, "select");
	}

	function handleDragStart(courseId: string): void {
		setSelectedCourse(courseId, "dragstart");
		draggedCourseId = courseId;
	}

	function handleDragEnd(): void {
		draggedCourseId = null;
		dragOverSemester = null;
	}

	function handleDropOnColumn(semester: string): void {
		if (!draggedCourseId) {
			return;
		}
		moveCourse(draggedCourseId, semester);
		handleDragEnd();
	}

	function handleDropOnCard(
		targetSemester: string,
		targetCourseId: string,
	): void {
		if (!draggedCourseId || draggedCourseId === targetCourseId) {
			return;
		}

		const index = columnCourseIds[targetSemester]?.indexOf(targetCourseId);
		moveCourse(
			draggedCourseId,
			targetSemester,
			index >= 0 ? index : undefined,
		);
		handleDragEnd();
	}

	$: {
		if (selectedCourseId) {
			const latest = coursesById[selectedCourseId];
			if (latest) {
				selectedCourseData = latest;
			}
		} else {
			selectedCourseData = null;
		}
	}

	$: selectedCourseResolved =
		selectedCourseData ??
		(selectedCourseId ? (coursesById[selectedCourseId] ?? null) : null);

	$: selectedCourseRequirementGroups = selectedCourseId
		? (prereqsByCourseId[selectedCourseId] ?? [])
		: [];

	$: selectedCourseValidCredits = selectedCourseResolved
		? getValidCredits(selectedCourseResolved.name)
		: [];

	$: hasVariableCredits =
		selectedCourseValidCredits.length > 1;

	function moveSelectedCourse(direction: -1 | 1): void {
		if (!selectedCourseId) {
			return;
		}

		const currentSemester = coursesById[selectedCourseId]?.semester;
		const currentIndex = semesterOrder.indexOf(currentSemester);
		if (currentIndex < 0) {
			return;
		}

		const nextIndex = currentIndex + direction;
		if (nextIndex < 0 || nextIndex >= semesterOrder.length) {
			return;
		}

		moveCourse(selectedCourseId, semesterOrder[nextIndex]);
	}

	function handleAutoDetangle(): void {
		void recalculateLayout(true);
	}

	function handleClearAllCourses(): void {
		if (Object.keys(coursesById).length === 0) {
			addCourseError = null;
			addCourseSuccess = "Schedule is already empty.";
			dataTransferMessage = null;
			return;
		}

		const confirmed = window.confirm(
			"Clear all scheduled courses? This will remove every class from every semester.",
		);
		if (!confirmed) {
			return;
		}

		coursesById = {};
		prereqsByCourseId = {};
		columnCourseIds = Object.fromEntries(
			semesterOrder.map((semester) => [semester, [] as string[]]),
		);
		courseElements = {};

		selectedCourseId = null;
		selectedCourseData = null;
		addCourseError = null;
		addCourseSuccess = "Cleared all courses from the schedule.";
		dataTransferMessage = null;

		void recalculateLayout(false);
	}

	function removeSelectedCourse(): void {
		if (!selectedCourseId) {
			return;
		}

		const courseId = selectedCourseId;
		const course = coursesById[courseId];
		if (!course) {
			return;
		}

		const nextCoursesById = { ...coursesById };
		delete nextCoursesById[courseId];

		const nextPrereqsByCourseId = { ...prereqsByCourseId };
		delete nextPrereqsByCourseId[courseId];

		const nextCourseElements = { ...courseElements };
		delete nextCourseElements[courseId];

		coursesById = nextCoursesById;
		prereqsByCourseId = nextPrereqsByCourseId;
		courseElements = nextCourseElements;

		if (columnCourseIds[course.semester]) {
			columnCourseIds = {
				...columnCourseIds,
				[course.semester]: (
					columnCourseIds[course.semester] ?? []
				).filter((id) => id !== courseId),
			};
		}

		selectedCourseId = null;
		selectedCourseData = null;
		addCourseSuccess = `Removed ${course.name} from ${course.semester}.`;
		addCourseError = null;

		void recalculateLayout(false);
	}

	function updateSelectedCourseCredits(newCredits: number): void {
		if (!selectedCourseId) {
			return;
		}

		const course = coursesById[selectedCourseId];
		if (!course) {
			return;
		}

		const validCredits = getValidCredits(course.name);
		if (!validCredits.includes(newCredits)) {
			return;
		}

		const updatedCourse = {
			...course,
			credits: newCredits,
		};

		coursesById = {
			...coursesById,
			[selectedCourseId]: updatedCourse,
		};

		selectedCourseData = updatedCourse;
		refreshSemesterCredits();
	}

	onMount(() => {
		const handleResize = () => queueEdgeMeasurement();
		window.addEventListener("resize", handleResize);

		void (async () => {
			try {
				const data = await loadSchedulerData();
				semesterOrder = data.semesterOrder;
				semesterToIndex = data.semesterToIndex;
				courseCatalog = data.catalog;
				coursesById = data.coursesById;
				columnCourseIds = data.columnCourseIds;
				prereqsByCourseId = data.prereqsByCourseId;
				selectedCourseId = null;
				selectedCourseData = null;

				updateGraph(true);
			} catch (loadError) {
				error =
					loadError instanceof Error
						? loadError.message
						: "Failed to load scheduler data.";
			} finally {
				loading = false;
				await tick();
				queueEdgeMeasurement();
			}
		})();

		return () => {
			window.removeEventListener("resize", handleResize);
		};
	});

	afterUpdate(() => {
		if (!loading && !error) {
			queueEdgeMeasurement();
		}
	});
</script>

<svelte:head>
	<title>Scheduler</title>
	<meta name="description" content="Interactive course scheduler with prerequisite validation and dependency visualization." />
</svelte:head>

<div class="page">
	<header class="page-header">
		<h1>> Utilities / Class Scheduler</h1>
		<p>
			Drag courses between semesters and inspect prerequisite health in
			real time. The default schedule is my own. Course data may not be
			fully accurate; please report any issues <a href="/contact">here</a
			>.
		</p>
	</header>

	{#if loading}
		<div class="terminal-box loading">> Bootstrapping scheduler...</div>
	{:else if error}
		<div class="terminal-box error">> {error}</div>
	{:else}
		<div class="scheduler-layout">
			<section class="terminal-box scheduler-board-wrap">
				<div class="scheduler-board" bind:this={boardElement}>
					<svg class="edge-layer" aria-hidden="true">
						{#each nonInvalidEdgeSegments as segment}
							<line
								x1={segment.x1}
								y1={segment.y1}
								x2={segment.x2}
								y2={segment.y2}
								class:edge-valid={segment.status === "valid"}
								class:edge-invalid={segment.status ===
									"invalid"}
								class:edge-concurrent={segment.status ===
									"concurrent"}
								class:edge-dimmed={segment.dimmed}
								class:edge-highlighted={segment.highlighted}
								class:edge-invalid-highlight={segment.highlighted &&
									segment.status === "invalid"}
							/>
						{/each}

						{#each invalidEdgeSegments as segment}
							<line
								x1={segment.x1}
								y1={segment.y1}
								x2={segment.x2}
								y2={segment.y2}
								class:edge-valid={segment.status === "valid"}
								class:edge-invalid={segment.status ===
									"invalid"}
								class:edge-concurrent={segment.status ===
									"concurrent"}
								class:edge-dimmed={segment.dimmed}
								class:edge-highlighted={segment.highlighted}
								class:edge-invalid-highlight={segment.highlighted &&
									segment.status === "invalid"}
							/>
						{/each}
					</svg>

					<div class="columns">
						{#each semesterOrder as semester (semester)}
							<div
								class="semester-column"
								class:drop-target={dragOverSemester ===
									semester}
								role="region"
								aria-label={`Semester ${semester}`}
								on:dragover={(event) => {
									event.preventDefault();
									dragOverSemester = semester;
								}}
								on:dragleave={() => {
									if (dragOverSemester === semester) {
										dragOverSemester = null;
									}
								}}
								on:drop={(event) => {
									event.preventDefault();
									handleDropOnColumn(semester);
								}}
							>
								<div class="semester-header">
									<h2>{semester}</h2>
									<span
										>{semesterCredits[semester] ?? 0} credits</span
									>
								</div>

								<div class="semester-courses">
									{#each columnCourseIds[semester] ?? [] as courseId (courseId)}
										{@const course = coursesById[courseId]}
										<button
											type="button"
											use:trackCourseElement={courseId}
											class="course-card"
											class:selected={selectedCourseId ===
												courseId}
											draggable="true"
											on:pointerdown={() =>
												setSelectedCourse(
													courseId,
													"pointerdown",
												)}
											on:focus={() =>
												setSelectedCourse(
													courseId,
													"focus",
												)}
											on:click={() =>
												setSelectedCourse(
													courseId,
													"click",
												)}
											on:dragstart={() =>
												handleDragStart(courseId)}
											on:dragend={handleDragEnd}
											on:dragover={(event) =>
												event.preventDefault()}
											on:drop={(event) => {
												event.preventDefault();
												handleDropOnCard(
													semester,
													courseId,
												);
											}}
										>
											<header>
												<h3>{course.name}</h3>
												<span>{course.credits}cr</span>
											</header>

											{#if typeof requirementProgressByCourseId[courseId] === "number"}
												<div class="progress-wrap">
													<div
														class="progress-fill"
														style={`width: ${Math.round(requirementProgressByCourseId[courseId] * 100)}%`}
													></div>
												</div>
											{/if}
										</button>
									{/each}
								</div>
							</div>
						{/each}
					</div>
				</div>
			</section>

			<aside class="terminal-box details">
				<div class="scheduler-controls">
					<button type="button" on:click={handleAutoDetangle}
						>Auto-detangle lines</button
					>
					<button
						type="button"
						class="clear-all-button"
						on:click={handleClearAllCourses}
					>
						Clear All Courses
					</button>
				</div>

				<div class="terminal-box add-course-box">
					<h3>Add Class</h3>
					<input
						type="text"
						placeholder="Search by course code or title"
						bind:value={addCourseQuery}
						list="course-catalog-options"
					/>
					<datalist id="course-catalog-options">
						{#each catalogSuggestionValues as suggestionValue}
							<option
								value={suggestionValue}
								label={suggestionValue}
							></option>
						{/each}
					</datalist>

					<select bind:value={addSemester}>
						{#each semesterOrder as semester}
							<option value={semester}>{semester}</option>
						{/each}
					</select>

					<button type="button" on:click={addCourseToSemester}
						>Add</button
					>
				</div>

				<div class="terminal-box io-box">
					<h3>Import / Export</h3>
					<div class="io-actions">
						<button type="button" on:click={handleExportJson}
							>Export JSON</button
						>
						<button
							type="button"
							on:click={() => importInputElement?.click()}
							>Import JSON</button
						>
						<input
							bind:this={importInputElement}
							type="file"
							accept="application/json"
							class="hidden-file-input"
							on:change={handleImportFile}
						/>
					</div>
				</div>

				{#if addCourseError}
					<p class="error-message">{addCourseError}</p>
				{/if}

				{#if addCourseSuccess}
					<p class="success-message">{addCourseSuccess}</p>
				{/if}

				{#if dataTransferMessage}
					<p class="success-message">{dataTransferMessage}</p>
				{/if}

				<div class="terminal-box selected-course-box">
					{#if selectedCourseResolved}
						{@const course = selectedCourseResolved}
						<h3>Selected Course</h3>
						<p><strong>{course?.name}</strong></p>
						<p>{course?.title}</p>
						<div class="credits-row">
							<span>{course?.credits} credits</span>
							{#if hasVariableCredits}
								<select
									value={course?.credits}
									on:change={(e) =>
										updateSelectedCourseCredits(
											Number.parseInt(
												e.currentTarget.value,
												10,
											),
										)
									}
									title="Change course credits"
								>
									{#each selectedCourseValidCredits as creditOption}
										<option value={creditOption}>
											{creditOption}
										</option>
									{/each}
								</select>
							{/if}
						</div>
						<p>Semester: {course?.semester}</p>
						{#if selectedCourseId && typeof requirementProgressByCourseId[selectedCourseId] === "number"}
							<p>
								Prereq coverage: {Math.round(
									(requirementProgressByCourseId[
										selectedCourseId
									] ?? 0) * 100,
								)}%
							</p>
						{/if}

						<div class="touch-controls">
							<button
								type="button"
								on:click={() => moveSelectedCourse(-1)}
								>Move Earlier</button
							>
							<button
								type="button"
								on:click={() => moveSelectedCourse(1)}
								>Move Later</button
							>
						</div>

						<button
							type="button"
							class="remove-course-button"
							on:click={removeSelectedCourse}
						>
							Remove Course
						</button>

						<h3>Requirement Groups</h3>
						{#if selectedCourseRequirementGroups.length === 0}
							<p>No catalog prerequisites.</p>
						{:else}
							<ul>
								{#each selectedCourseRequirementGroups as requirement}
									<li>
										{requirement.courseChoices.join(" OR ")}
										{#if requirement.canBeConcurrent}
											<span class="req-tag"
												>concurrent allowed</span
											>
										{/if}
									</li>
								{/each}
							</ul>
						{/if}
					{:else}
						<h3>Selected Course</h3>
						<p>Select a course card to inspect details.</p>
					{/if}
				</div>
			</aside>
		</div>
	{/if}
</div>

<style>
	.page {
		animation: fadeIn 0.5s ease-in;
	}

	@keyframes fadeIn {
		from {
			opacity: 0.5;
		}
		to {
			opacity: 1;
		}
	}

	.page-header {
		margin-bottom: 2rem;
		padding-bottom: 1.5rem;
		border-bottom: 1px dashed var(--color-text-primary);
	}

	.page-header h1 {
		font-size: 2rem;
		margin-bottom: 0.6rem;
	}

	.scheduler-layout {
		display: grid;
		grid-template-columns: 2fr 1fr;
		gap: 1.25rem;
	}

	.scheduler-board-wrap {
		overflow: auto;
		position: relative;
		min-height: 60vh;
	}

	.scheduler-board {
		position: relative;
		min-width: 900px;
	}

	.edge-layer {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
		z-index: 0;
	}

	.edge-layer line {
		stroke-width: 2.5;
		transition: opacity 0.2s ease;
	}

	.edge-valid {
		stroke: var(--color-success);
	}

	.edge-invalid {
		stroke: var(--color-error);
	}

	.edge-concurrent {
		stroke: #00e7ff;
		stroke-dasharray: 8 6;
	}

	.edge-dimmed {
		opacity: 0.23;
		stroke-width: 2;
	}

	.edge-highlighted {
		opacity: 1;
		stroke-width: 5;
		filter: drop-shadow(0 0 4px currentColor);
	}

	.edge-invalid-highlight {
		stroke: #ff1f1f;
		filter: drop-shadow(0 0 7px #ff1f1f);
	}

	.columns {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
		gap: 0.85rem;
		position: relative;
		z-index: 1;
	}

	.semester-column {
		border: 1px solid var(--color-primary-opacity-30);
		border-radius: 3px;
		padding: 0.75rem;
		background: var(--color-primary-opacity-10);
		min-height: 100%;
	}

	.semester-column.drop-target {
		box-shadow: inset 0 0 0 2px var(--color-text-primary);
	}

	.semester-header {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
		border-bottom: 1px dashed var(--color-primary-opacity-30);
		padding-bottom: 0.45rem;
	}

	.semester-header h2 {
		font-size: 1.1rem;
		border: 0;
		margin: 0;
		text-transform: uppercase;
	}

	.semester-header span {
		font-size: 0.85rem;
		opacity: 0.9;
	}

	.semester-courses {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		min-height: 200px;
	}

	.course-card {
		background: var(--color-primary-opacity-15);
		border: 1px solid var(--color-primary-opacity-30);
		border-radius: 3px;
		padding: 0.6rem;
		cursor: grab;
		user-select: none;
		text-align: left;
		width: 100%;
	}

	.course-card header {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		align-items: baseline;
	}

	.course-card h3 {
		font-size: 0.95rem;
		margin: 0;
		line-height: 1.35;
	}

	.course-card span {
		font-size: 0.8rem;
		opacity: 0.85;
	}

	.course-card.selected {
		box-shadow: 0 0 0 2px var(--color-text-primary);
		background: var(--color-primary-opacity-30);
	}

	.progress-wrap {
		height: 6px;
		width: 100%;
		background: var(--color-error-opacity-05);
		border: 1px solid var(--color-primary-opacity-30);
		margin-top: 0.55rem;
	}

	.progress-fill {
		height: 100%;
		background: var(--color-success);
	}

	.details {
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
	}

	.scheduler-controls {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-bottom: 0.25rem;
	}

	.scheduler-controls button {
		width: 100%;
		font-size: 0.86rem;
		padding: 0.55rem 0.8rem;
	}

	.clear-all-button {
		border-color: var(--color-error);
		color: var(--color-error);
	}

	.clear-all-button:hover {
		background: var(--color-error-opacity-05);
		color: var(--color-error);
	}

	.add-course-box,
	.io-box,
	.selected-course-box {
		border-width: 1px;
		margin: 0;
		padding: 0.8rem;
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
	}

	.add-course-box h3,
	.io-box h3,
	.selected-course-box h3 {
		font-size: 0.95rem;
	}

	.selected-course-box p {
		font-size: 0.9rem;
	}

	.credits-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9rem;
	}

	.credits-row select {
		background: var(--color-bg-dark);
		color: var(--color-text-primary);
		border: 1px solid var(--color-primary-opacity-30);
		border-radius: 3px;
		padding: 0.3rem 0.4rem;
		font-family: inherit;
		font-size: 0.85rem;
		cursor: pointer;
	}

	.credits-row select:hover {
		border-color: var(--color-text-primary);
	}

	.remove-course-button {
		border-color: var(--color-error);
		color: var(--color-error);
	}

	.remove-course-button:hover {
		background: var(--color-error-opacity-05);
		color: var(--color-error);
	}

	.add-course-box input,
	.add-course-box select {
		background: var(--color-bg-dark);
		color: var(--color-text-primary);
		border: 1px solid var(--color-primary-opacity-30);
		border-radius: 3px;
		padding: 0.45rem 0.55rem;
		font-family: inherit;
		font-size: 0.85rem;
	}

	.io-actions {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
	}

	.hidden-file-input {
		display: none;
	}

	.error-message,
	.success-message {
		border: 1px solid var(--color-primary-opacity-30);
		border-radius: 3px;
		padding: 0.45rem 0.55rem;
		font-size: 0.8rem;
		line-height: 1.35;
	}

	.error-message {
		color: var(--color-error);
		background: var(--color-error-opacity-05);
		border-color: var(--color-error);
	}

	.success-message {
		color: var(--color-success);
		background: var(--color-success-opacity-05);
		border-color: var(--color-success);
	}

	.details h3 {
		margin: 0;
		border: 0;
		font-size: 1.1rem;
	}

	.details p {
		margin: 0;
	}

	.details ul {
		margin: 0;
		padding-left: 1.2rem;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.req-tag {
		display: inline-block;
		margin-left: 0.5rem;
		font-size: 0.75rem;
		color: #00e7ff;
	}

	.touch-controls {
		display: flex;
		gap: 0.6rem;
		margin: 0.35rem 0 0.8rem;
	}

	.touch-controls button {
		font-size: 0.82rem;
		padding: 0.4rem 0.7rem;
	}

	@media (max-width: 1200px) {
		.scheduler-layout {
			grid-template-columns: 1fr;
		}

		.scheduler-board {
			min-width: 760px;
		}
	}

	@media (max-width: 768px) {
		.page-header h1 {
			font-size: 1.45rem;
		}

		.scheduler-board-wrap {
			padding: 0.65rem;
		}

		.scheduler-board {
			min-width: 680px;
		}

		.touch-controls {
			flex-direction: column;
		}
	}
</style>
