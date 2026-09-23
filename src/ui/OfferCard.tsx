// A world offer, presented as the decision it is: what it costs now, what it
// gives, what it obliges, and how long you have to answer. Both answers are
// on the card — declining is a real choice, not a dismissal.

import type { GameState, WorldOffer } from '../engine'
import { viewSeat, dispatch } from './session'
import { money } from './format'

// Rules 6 can put more than one question on the table at once (the regular
// offer and one per announced event touching the network): show each.
export function OfferCard({ state }: { state: GameState }) {
  const offers = state.world.offers.filter((o) => (o.airline ?? 0) === viewSeat())
  if (offers.length === 0 || state.phase !== 'planning') return null
  return <>{offers.map((offer) => <OfferItem key={offer.id} state={state} offer={offer} />)}</>
}

function OfferItem({ state, offer }: { state: GameState; offer: WorldOffer }) {
  const player = state.airlines[viewSeat()]!
  const quartersLeft = offer.expiresTurn - state.turn
  const affordable = player.cash >= offer.costK
  return (
    <div className="scenario-card offer-card" data-testid="offer-card">
      <h2>
        📨 {offer.headline}
      </h2>
      <p className="dim" data-testid="offer-detail">
        {offer.detail}
      </p>
      <p>
        {offer.incomeK ? (
          <><strong className="pos" data-testid="offer-income">+{money(offer.incomeK)}/quarter</strong> while it runs · nothing up front</>
        ) : (
          <><strong className={affordable ? '' : 'neg'}>{money(offer.costK)}</strong> up front</>
        )}
        {offer.upkeepK > 0 && (
          <>
            {' · '}
            <span className="neg">{money(offer.upkeepK)}/quarter</span> until it runs out
          </>
        )}
        {' · '}
        <span className={quartersLeft <= 1 ? 'neg' : 'dim'} data-testid="offer-deadline">
          {quartersLeft <= 1 ? 'decide this quarter' : `${quartersLeft} quarters to decide`}
        </span>
      </p>
      <button
        data-testid="offer-accept"
        disabled={!affordable}
        title={affordable ? undefined : 'not enough cash for the up-front payment'}
        onClick={() => dispatch({ type: 'accept_offer', offerId: offer.id })}
      >
        ✔ Take the deal
      </button>{' '}
      <button data-testid="offer-decline" onClick={() => dispatch({ type: 'decline_offer', offerId: offer.id })}>
        ✕ Pass
      </button>
    </div>
  )
}

export function dealIcon(kind: string): string {
  return kind === 'hub_strike' ? '✊' : kind === 'airlift_contract' ? '🛩️' : kind === 'official_carrier' ? '🏅' : '🤝'
}

export function dealLabel(d: { kind: string; city: string | null; region?: string; pair?: string }): string {
  const where = d.city ?? d.region?.toUpperCase() ?? ''
  switch (d.kind) {
    case 'capacity_commitment': return `${where} commitment`
    case 'regulator_slots': return `${where} obligation`
    case 'hub_strike': return `${where} strike`
    case 'route_rights': return `${d.pair?.replace('-', '–')} exclusive`
    case 'official_carrier': return `official carrier · ${where}`
    case 'airlift_contract': return `airlift · ${where}`
    default: return 'fuel contract'
  }
}

// Deals still running, so the player can see what they committed to.
export function ActiveDeals({ state }: { state: GameState }) {
  const deals = state.airlines[viewSeat()]!.deals ?? []
  if (deals.length === 0) return null
  return (
    <p className="events-strip" data-testid="active-deals">
      {deals.map((d) => (
        <span key={d.offerId} className="event-chip" title={`runs until quarter ${d.untilTurn}`}>
          {dealIcon(d.kind)} {dealLabel(d)}
          {d.upkeepK > 0 && ` · ${money(d.upkeepK)}/q`}
          {d.incomeK ? ` · +${money(d.incomeK)}/q` : ''}
        </span>
      ))}
    </p>
  )
}
