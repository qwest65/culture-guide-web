import { useRoute } from './router';
import { Home } from './screens/Home';
import { CityScreen } from './screens/City';
import { RouteScreen } from './screens/Route';
import { PlaceScreen } from './screens/Place';
import { WalkScreen } from './screens/Walk';
import { NotFound } from './ui';

export function App() {
  const route = useRoute();
  switch (route.name) {
    case 'home':
      return <Home />;
    case 'city':
      return <CityScreen key={route.city} id={route.city} />;
    case 'route':
      return <RouteScreen key={route.id} city={route.city} id={route.id} />;
    case 'walk':
      return <WalkScreen key={route.id} city={route.city} id={route.id} />;
    case 'place':
      return <PlaceScreen key={route.id} city={route.city} id={route.id} />;
    default:
      return <NotFound />;
  }
}
