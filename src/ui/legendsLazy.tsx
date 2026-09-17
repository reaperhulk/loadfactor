// Lazy twins of the handbook legends. Legends sit inside closed <details>
// on many screens and carry no focus behavior, so the shell can leave them
// out of its first paint and still keep every screen's help in place.
import { lazy, Suspense } from 'react'

const legends = () => import('./legends')
const Cabin = lazy(() => legends().then((m) => ({ default: m.CabinLegend })))
const Service = lazy(() => legends().then((m) => ({ default: m.ServiceLegend })))
const Hub = lazy(() => legends().then((m) => ({ default: m.HubLegend })))
const Spool = lazy(() => legends().then((m) => ({ default: m.SpoolLegend })))
const Season = lazy(() => legends().then((m) => ({ default: m.SeasonLegend })))
const Marketing = lazy(() => legends().then((m) => ({ default: m.MarketingLegend })))
const Hedge = lazy(() => legends().then((m) => ({ default: m.HedgeLegend })))
const Slot = lazy(() => legends().then((m) => ({ default: m.SlotLegend })))
const Takeover = lazy(() => legends().then((m) => ({ default: m.TakeoverLegend })))
const Rivalry = lazy(() => legends().then((m) => ({ default: m.RivalryLegend })))
const Reliability = lazy(() => legends().then((m) => ({ default: m.ReliabilityLegend })))

export const CabinLegend = ({ modern }: { modern?: boolean }) => <Suspense fallback={null}><Cabin modern={modern} /></Suspense>
export const ServiceLegend = () => <Suspense fallback={null}><Service /></Suspense>
export const HubLegend = () => <Suspense fallback={null}><Hub /></Suspense>
export const SpoolLegend = () => <Suspense fallback={null}><Spool /></Suspense>
export const SeasonLegend = () => <Suspense fallback={null}><Season /></Suspense>
export const MarketingLegend = () => <Suspense fallback={null}><Marketing /></Suspense>
export const HedgeLegend = () => <Suspense fallback={null}><Hedge /></Suspense>
export const SlotLegend = () => <Suspense fallback={null}><Slot /></Suspense>
export const TakeoverLegend = () => <Suspense fallback={null}><Takeover /></Suspense>
export const RivalryLegend = () => <Suspense fallback={null}><Rivalry /></Suspense>
export const ReliabilityLegend = ({ modern }: { modern?: boolean }) => <Suspense fallback={null}><Reliability modern={modern} /></Suspense>
