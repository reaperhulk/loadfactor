// A world offer, presented as the decision it is: what it costs now, what it
// gives, what it obliges, and how long you have to answer. Both answers are
// on the card — declining is a real choice, not a dismissal.

import type { GameState } from '../engine'
import { dispatch } from './session'
import { money } from './format'

export function OfferCard({ state }: { state: GameState }) {
  const offer = state.world.offers[0]
  if (!offer) return null
  const player = state.airlines[0]!
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
        <strong className={affordable ? '' : 'neg'}>{money(offer.costK)}</strong> up front
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

// Deals still running, so the player can see what they committed to.
export function ActiveDeals({ state }: { state: GameState }) {
  const deals = state.airlines[0]!.deals ?? []
  if (deals.length === 0) return null
  return (
    <p className="events-strip" data-testid="active-deals">
      {deals.map((d) => (
        <span key={d.offerId} className="event-chip" title={`runs until quarter ${d.untilTurn}`}>
          🤝 {d.kind === 'capacity_commitment' ? `${d.city} commitment` : d.kind === 'regulator_slots' ? `${d.city} obligation` : 'fuel contract'}
          {d.upkeepK > 0 && ` · ${money(d.upkeepK)}/q`}
        </span>
      ))}
    </p>
  )
}
