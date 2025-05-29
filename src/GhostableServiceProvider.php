<?php

namespace Ghostable;

use Illuminate\Support\ServiceProvider;

class GhostableServiceProvider extends ServiceProvider
{
    // public function register(): void
    // {
    //     $this->mergeConfigFrom(__DIR__.'/../config/domain-tools.php', 'domain-tools');
    // }

    // public function boot(): void
    // {
    //     $this->publishes([
    //         __DIR__.'/../config/domain-tools.php' => config_path('domain-tools.php'),
    //     ], 'domain-tools-config');

    //     if ($this->app->runningInConsole()) {
    //         $this->commands([
    //             \Joerucci\DomainTools\Commands\MakeCastCommand::class,
    //             \Joerucci\DomainTools\Commands\MakeChannelCommand::class,
    //             \Joerucci\DomainTools\Commands\MakeClassCommand::class,
    //             \Joerucci\DomainTools\Commands\MakeControllerCommand::class,
    //             \Joerucci\DomainTools\Commands\MakeDomainCommand::class,
    //             \Joerucci\DomainTools\Commands\MakeEnumCommand::class,
    //             \Joerucci\DomainTools\Commands\MakeEventCommand::class,
    //             \Joerucci\DomainTools\Commands\MakeExceptionCommand::class,
    //             \Joerucci\DomainTools\Commands\MakeInterfaceCommand::class,
    //             \Joerucci\DomainTools\Commands\MakeJobCommand::class,
    //             \Joerucci\DomainTools\Commands\MakeJobMiddlewareCommand::class,
    //             \Joerucci\DomainTools\Commands\MakeListenerCommand::class,
    //             \Joerucci\DomainTools\Commands\MakeMailCommand::class,
    //             \Joerucci\DomainTools\Commands\MakeMiddlewareCommand::class,
    //             \Joerucci\DomainTools\Commands\MakeModelCommand::class,
    //             \Joerucci\DomainTools\Commands\MakeNotificationCommand::class,
    //             \Joerucci\DomainTools\Commands\MakeObserverCommand::class,
    //             \Joerucci\DomainTools\Commands\MakePolicyCommand::class,
    //             \Joerucci\DomainTools\Commands\MakeProviderCommand::class,
    //             \Joerucci\DomainTools\Commands\MakeRequestCommand::class,
    //             \Joerucci\DomainTools\Commands\MakeRuleCommand::class,
    //             \Joerucci\DomainTools\Commands\MakeScopeCommand::class,
    //             \Joerucci\DomainTools\Commands\MakeTraitCommand::class,
    //         ]);
    //     }
    // }
}
