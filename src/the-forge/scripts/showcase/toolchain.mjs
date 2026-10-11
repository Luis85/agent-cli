import { project } from './project.mjs';

/**
 * The Trailhead library's public API: the scaffold's form runtime plus the
 * generated model, use cases, form and data-source adapters. Exporting them
 * makes them part of the library contract that the project's own fallow gate
 * checks for unused code.
 */
const publicApi = `export { ProjectIdentity } from './domain/project-identity.js';
export { ProjectDetailsForm, type ProjectDetailsValues } from './presentation/forms/project-details.form.js';
export { validateForm, type FormDefinition, type FormField, type FormValidation } from './presentation/forms/form-model.js';
export { renderForm } from './presentation/forms/form-view.js';

// Trailhead domain and application model.
export { Trip } from './domain/trip.js';
export { Itinerary } from './domain/trips/itinerary.js';
export { TripWindow } from './domain/trips/trip-window.js';
export { TripPlannedEvent, type TripPlanned } from './domain/trips/trip-planned.js';
export { PlanTrip, type PlanTripRepository } from './application/plan-trip.js';
export { ShareItinerary, type ShareItineraryInput, type ShareItineraryRepository } from './application/trips/share-itinerary.js';
export { TripRequestForm, type TripRequestValues } from './presentation/forms/trip-request.form.js';

// Generated data-source adapters.
export {
  createTripRecordDataSource, validateTripRecord, validateTripRecordId, validateTripRecordList, TripRecordDataSourceError,
  type TripRecord, type TripRecordId, type TripRecordQuery, type TripRecordDataSourceOptions,
} from './infrastructure/data-sources/trips-api.js';
export {
  createTrailGuideDataSource, validateTrailGuide, validateTrailGuideId, validateTrailGuideList, TrailGuideDataSourceError,
  type TrailGuide, type TrailGuideId, type TrailGuideDataSourceOptions,
} from './infrastructure/data-sources/trail-guides.js';
`;

/**
 * Publish the generated code through src/index.ts, the library contract that the project's own fallow gate checks
 * for unused code. The scaffold's configuration already keeps the framework UI under ui/ out of the library checks.
 * @param {import('./cli.mjs').ForgeCli} cli
 */
export function configureToolchain(cli) {
  cli.begin('Project toolchain');
  cli.run(['project', 'inspect', project.id]);
  cli.replace('src/index.ts', publicApi);
}
